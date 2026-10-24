import fs from 'fs';
import { join } from 'path';
import { getDeprecation } from './deprecations.js';
import type { Packages, PackageProject, SearchResult } from '../types/index.js';

const EXCLUDED_DIRS = ['node_modules', 'src', 'scripts', 'lib', 'dist', 'public', '.github'];

/**
 * Splits a version string into its numeric core and its pre-release tag.
 *
 * @param version - Version string (e.g., "6.0.0" or "6.0.0-pre")
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
 * @param a - First version string
 * @param b - Second version string
 * @returns Negative if a < b, positive if a > b, zero if equal
 */
function compareVersions(a: string, b: string): number {
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
 * Picks the newest of a list of versions, preferring releases over pre-releases,
 * so a pre-release is only picked when nothing stable matches.
 *
 * @param versions - Candidate version strings
 * @returns The newest version, or null if the list is empty
 */
function pickNewest(versions: string[]): string | null {
    const releases = versions.filter((v) => parseVersion(v).pre === null);

    return (releases.length > 0 ? releases : versions).sort(compareVersions).at(-1) ?? null;
}

/**
 * Dynamically scans the filesystem to discover all available packages.
 *
 * @param rootDir - Root directory to scan for package types
 * @returns Structured packages object with types, projects and versions
 */
export function getPackages(rootDir: string): Packages {
    const packages: Packages = {};

    try {
        const packageTypes = fs
            .readdirSync(rootDir, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
            .map((dirent) => dirent.name)
            .filter((name) => !EXCLUDED_DIRS.includes(name));

        packageTypes.forEach((type) => {
            const typePath = join(rootDir, type);
            packages[type] = { list: `/${type}` };

            const projects = fs
                .readdirSync(typePath, { withFileTypes: true })
                .filter((dirent) => dirent.isDirectory())
                .map((dirent) => dirent.name);

            projects.forEach((project) => {
                const projectPath = join(typePath, project);
                const projectEntry: PackageProject = {
                    list: `/${type}/${project}`,
                    versions: {},
                };

                const versions = fs
                    .readdirSync(projectPath, { withFileTypes: true })
                    .filter((dirent) => dirent.isDirectory())
                    .map((dirent) => dirent.name)
                    .sort(compareVersions);

                projectEntry.versions['latest'] = `/${type}/${project}@latest`;
                versions.forEach((version) => {
                    projectEntry.versions[version] = `/${type}/${project}@${version}`;
                });
                projectEntry.deprecated = getDeprecation(projectPath);

                packages[type][project] = projectEntry;
            });
        });
    } catch (error) {
        console.error('Error scanning packages:', error);
    }

    return packages;
}

/**
 * Searches packages by project name or package type, case-insensitively.
 * A project matches when its name contains the query, or when the query is exactly
 * its type, in which case every project of that type is returned.
 *
 * @param packages - The packages object from getPackages()
 * @param query - Search query string
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
 * @param packages - The packages object from getPackages()
 * @returns Total package count
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
 * Examples: "3" -> "3.5.0", "3.0" -> "3.0.2"
 *
 * @param versionPattern - Partial version pattern (e.g., "3", "3.0")
 * @param projectEntry - The project entry containing all versions
 * @returns The resolved full version or null if no match found
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
 * Resolves the "latest" alias to the newest release of a project, or to its
 * newest pre-release when it has no release yet.
 *
 * @param projectEntry - The project entry containing all versions
 * @returns The latest version of the project
 */
export function latestVersion(projectEntry: PackageProject): string {
    return pickNewest(Object.keys(projectEntry.versions).filter((v) => v !== 'latest'))!;
}
