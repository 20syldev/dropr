import type {
    Catalog,
    CatalogVersion,
    Index,
    IndexDir,
    IndexNode,
    PackageProject,
    Packages,
    SearchResult,
} from '../types/index.js';

export const EXCLUDED_DIRS = ['node_modules', 'src', 'scripts', 'lib', 'dist', 'public', '.github'];

// Top-level paths taken by the server's own routes, never scanned as package types
export const RESERVED_NAMES = ['download', 'health', 'manifest', 'search'];

/**
 * Splits a version string into its numeric core and its pre-release tag.
 *
 * @param version - Dotted version, the pre-release tag being everything after the first dash (e.g., "6.0.0-pre")
 * @returns Numeric core segments and pre-release tag, null for a release
 */
function parseVersion(version: string): { core: number[]; pre: string | null } {
    const dash = version.indexOf('-');
    if (dash === -1) return { core: version.split('.').map(Number), pre: null };

    return { core: version.slice(0, dash).split('.').map(Number), pre: version.slice(dash + 1) };
}

/**
 * Compares two semantic version strings numerically.
 * Handles varying version segment counts (e.g., "1.0" vs "1.0.0"), and orders
 * a pre-release before its release (e.g., "6.0.0-pre" < "6.0.0").
 *
 * @param a - Left-hand version, its missing or non-numeric segments counting as 0
 * @param b - Right-hand version, parsed the same way as a
 * @returns Negative if a < b, positive if a > b, zero if equal
 */
export function compareVersions(a: string, b: string): number {
    const aVersion = parseVersion(a);
    const bVersion = parseVersion(b);

    for (let i = 0; i < Math.max(aVersion.core.length, bVersion.core.length); i++) {
        const aPart = aVersion.core[i] || 0;
        const bPart = bVersion.core[i] || 0;
        if (aPart !== bPart) return aPart - bPart;
    }

    if (aVersion.pre === bVersion.pre) return 0;
    if (aVersion.pre === null) return 1;
    if (bVersion.pre === null) return -1;

    return aVersion.pre.localeCompare(bVersion.pre, 'en', { numeric: true });
}

/**
 * Picks the newest of a list of versions, preferring releases over pre-releases.
 * A pre-release is only picked when the list holds no release.
 *
 * @param versions - Candidate versions, sorted in place when none of them is a release
 * @returns The newest version, or null if the list is empty
 */
function pickNewest(versions: string[]): string | null {
    const releases = versions.filter((v) => parseVersion(v).pre === null);

    return (releases.length > 0 ? releases : versions).sort(compareVersions).at(-1) ?? null;
}

/**
 * Records every node below a folder of a version by its path, without following links.
 *
 * @param dir - Folder whose entries are recorded, nothing being recorded below one that could not be read
 * @param path - Path of dir relative to the version folder, '' for the version folder itself
 * @param nodes - Map filled in place, its keys joined with '/' and without a leading slash
 */
export function indexNodes(dir: IndexDir, path: string, nodes: Map<string, IndexNode>): void {
    for (const node of dir.entries ?? []) {
        const child = path === '' ? node.name : `${path}/${node.name}`;
        nodes.set(child, node);
        if (node.kind === 'dir') indexNodes(node, child, nodes);
    }
}

/**
 * Loads a packages index into the lookups the routes read, without touching the disk.
 * The packages object is built with the assignments of the 3.3.1 disk scan, so its key order and own keys match.
 *
 * @param index - Index of format 1, its arrays in strcmp order and its versions sorted by compareVersions; another
 * format throws
 * @returns The packages object, and each version by its 'type/project/version' key, its nodes keyed by their real
 * path relative to the version folder, '' being the folder itself
 */
export function loadIndex(index: Index): Catalog {
    if (index.format !== 1) throw new Error(`Unsupported packages index format: ${String(index.format)}`);

    const packages: Packages = {};
    const versions = new Map<string, CatalogVersion>();

    for (const type of index.types) {
        packages[type.name] = { list: `/${type.name}` };

        for (const project of type.projects) {
            const projectEntry: PackageProject = {
                list: `/${type.name}/${project.name}`,
                versions: {},
            };

            projectEntry.versions['latest'] = `/${type.name}/${project.name}@latest`;
            for (const version of project.versions) {
                projectEntry.versions[version.name] = `/${type.name}/${project.name}@${version.name}`;

                const nodes = new Map<string, IndexNode>([['', version.root]]);
                indexNodes(version.root, '', nodes);
                versions.set(`${type.name}/${project.name}/${version.name}`, {
                    type: type.name,
                    project: project.name,
                    name: version.name,
                    date: version.date,
                    root: version.root,
                    nodes,
                });
            }
            projectEntry.deprecated = project.deprecated ?? undefined;

            packages[type.name][project.name] = projectEntry;
        }
    }

    return { packages, versions };
}

/**
 * Tells whether a package type exists.
 * Only own keys count, so names like '__proto__' or 'constructor' never match.
 *
 * @param packages - The packages object from loadIndex()
 * @param type - Untrusted package type from the URL
 * @returns True if the type was found on disk
 */
export function hasType(packages: Packages, type: string): boolean {
    return Object.hasOwn(packages, type);
}

/**
 * Looks up a project of a package type.
 * Only own keys count and the 'list' key of a type is not a project, so
 * '/npm/list' or '/npm/__proto__' resolve to nothing.
 *
 * @param packages - The packages object from loadIndex()
 * @param type - Untrusted package type from the URL
 * @param name - Untrusted project name from the URL
 * @returns The project entry, or undefined if the type or the project does not exist
 */
export function getProject(packages: Packages, type: string, name: string): PackageProject | undefined {
    if (!hasType(packages, type) || name === 'list' || !Object.hasOwn(packages[type], name)) return undefined;

    return packages[type][name] as PackageProject;
}

/**
 * Lists the projects of a package type, without its 'list' key.
 *
 * @param packages - The packages object from loadIndex()
 * @param type - Existing package type
 * @returns Pairs of project names and entries, in scan order
 */
export function listProjects(packages: Packages, type: string): [string, PackageProject][] {
    return Object.entries(packages[type])
        .filter(([name]) => name !== 'list')
        .map(([name, entry]) => [name, entry as PackageProject]);
}

/**
 * Searches packages by project name or package type, case-insensitively.
 * A project matches when its name contains the query, or when the query is exactly
 * its type, in which case every project of that type is returned.
 *
 * @param packages - The packages object from loadIndex()
 * @param query - Text matched in any case, an empty query matching every project
 * @returns Matching packages with type, name, versions and url, name matches first
 */
export function searchPackages(packages: Packages, query: string): SearchResult[] {
    const named: SearchResult[] = [];
    const typed: SearchResult[] = [];
    const q = query.toLowerCase();
    for (const type of Object.keys(packages)) {
        const typeMatch = type.toLowerCase() === q;
        for (const project of Object.keys(packages[type])) {
            if (project === 'list') continue;
            const nameMatch = project.toLowerCase().includes(q);
            if (!nameMatch && !typeMatch) continue;

            const entry = packages[type][project] as PackageProject;
            const result: SearchResult = {
                type,
                name: project,
                versions: Object.keys(entry.versions),
                url: `/${type}/${project}`,
                deprecated: entry.deprecated,
            };

            (nameMatch ? named : typed).push(result);
        }
    }

    return [...named, ...typed];
}

/**
 * Counts the total number of packages across all types.
 *
 * @param packages - The packages object from loadIndex()
 * @returns Number of projects across all types, the 'list' keys left out
 */
export function countPackages(packages: Packages): number {
    let count = 0;
    for (const type of Object.keys(packages)) {
        for (const key of Object.keys(packages[type])) {
            if (key !== 'list') count++;
        }
    }
    return count;
}

/**
 * Resolves partial version patterns to the latest matching full version.
 * For example, "3" resolves to "3.5.0" and "3.0" to "3.0.2" when those are the newest matches.
 *
 * @param versionPattern - Leading segments such as "3" or "3.0", with or without a trailing dot, or a full version
 * @param projectEntry - Project entry whose version keys are searched, the 'latest' alias skipped
 * @returns The newest matching version, a release when one matches, or null if no match found
 */
export function resolveVersion(versionPattern: string, projectEntry: PackageProject): string | null {
    const normalizedPattern = versionPattern.endsWith('.') ? versionPattern : `${versionPattern}.`;

    return pickNewest(
        Object.keys(projectEntry.versions).filter(
            (v) => v !== 'latest' && (v === versionPattern || v.startsWith(normalizedPattern)),
        ),
    );
}

/**
 * Resolves the "latest" alias to the newest version of a project.
 * The newest release wins, a pre-release is only returned when the project has no release yet.
 *
 * @param projectEntry - Project entry whose version keys are searched, the 'latest' alias skipped
 * @returns The newest version key, never the 'latest' alias itself, or null for a project without versions
 */
export function latestVersion(projectEntry: PackageProject): string | null {
    return pickNewest(Object.keys(projectEntry.versions).filter((v) => v !== 'latest'));
}
