import type {
    Catalog,
    CatalogDir,
    CatalogNode,
    CatalogProject,
    CatalogType,
    CatalogVersion,
    Deprecation,
    Index,
    IndexNode,
    IndexProject,
    IndexType,
    IndexVersion,
    SearchResult,
} from '../types/index.js';

import { parseDay } from './dates.js';
import { parseDeprecation } from './deprecations.js';
import { compareBytes } from './order.js';
import { isName, isProjectName, isSegment } from './router.js';
import { compareVersions, isRelease, isVersion } from './semver.js';

interface Load {
    label: string;
    nodes: Map<string, CatalogNode>;
}

// SHA-256 as ?checksums prints it and the ETag quotes it
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Throws the error of an index that the core cannot serve.
 *
 * @param where - Place of the fault, such as type npm or npm/lib/1.0.0/dist/index.js
 * @param why - What is wrong there, without a final period
 * @returns Never, since it always throws an Error that names the place
 */
function refuse(where: string, why: string): never {
    throw new Error(`Invalid packages index: ${where} ${why}.`);
}

/**
 * Loads the entries of a folder of a version, each one checked and recorded by its path.
 *
 * @param entries - Entries of the index folder, which must be unique and in ascending UTF-8 byte order
 * @param path - Path of the folder inside the version, '' for the version folder itself
 * @param load - Version being loaded, its label naming the faults and its nodes receiving each node by path
 * @returns The catalog nodes in the same order, the folders being new nodes with their size left to measure
 */
function loadEntries(entries: IndexNode[], path: string, load: Load): CatalogNode[] {
    if (!Array.isArray(entries)) refuse(`${load.label}/${path}`, 'has no entries');

    let previous: string | undefined;

    return entries.map((node) => {
        if (typeof node?.name !== 'string' || !isSegment(node.name)) {
            refuse(`${load.label}/${path}`, `holds the name ${JSON.stringify(node?.name)}, which no route can match`);
        }
        if (previous !== undefined && compareBytes(previous, node.name) >= 0) {
            refuse(`${load.label}/${path}`, `lists ${node.name} after ${previous}, names must be unique and ascending`);
        }
        previous = node.name;

        return loadNode(node, path === '' ? node.name : `${path}/${node.name}`, load);
    });
}

/**
 * Loads one node of a version, a folder with everything below it.
 *
 * @param node - Node of the index, whose fields are checked by kind
 * @param path - Path of the node inside the version
 * @param load - Version being loaded
 * @returns A new node for a folder, the node itself for a file or a link
 */
function loadNode(node: IndexNode, path: string, load: Load): CatalogNode {
    const where = `${load.label}/${path}`;

    if (node.kind === 'dir') {
        const dir: CatalogDir = { kind: 'dir', name: node.name, size: 0, entries: [] };
        load.nodes.set(path, dir);
        dir.entries = loadEntries(node.entries, path, load);

        return dir;
    }
    if (node.kind === 'file') {
        if (!Number.isSafeInteger(node.size) || node.size < 0) refuse(where, 'has a size that is not a byte count');
        if (typeof node.exec !== 'boolean') refuse(where, 'has no execute flag');
        if (typeof node.sha256 !== 'string' || !SHA256.test(node.sha256)) refuse(where, 'has no SHA-256 in hex');
    } else if (node.kind === 'link') {
        if (typeof node.target !== 'string') refuse(where, 'has no target');
        if (node.real !== undefined && typeof node.real !== 'string') refuse(where, 'has a real path that is no text');
    } else {
        refuse(where, 'is neither a folder, a file nor a link');
    }

    load.nodes.set(path, node);

    return node;
}

/**
 * Sets the size of a folder of a version and of every folder below it, and checks the links on the way.
 * A link to a file counts as its target, a link to a folder or a link that leads nowhere counts nothing.
 *
 * @param dir - Folder to measure, its size and the sizes of its subfolders set in place
 * @param load - Version holding the folder, whose nodes resolve the real path of each link
 * @returns Total size in bytes of the files below dir; throws when a link has a real path that is not a file or a folder
 * of the version
 */
function measure(dir: CatalogDir, load: Load): number {
    let total = 0;
    for (const node of dir.entries) {
        if (node.kind === 'dir') {
            total += measure(node, load);
        } else if (node.kind === 'file') {
            total += node.size;
        } else if (node.real !== undefined) {
            const target = load.nodes.get(node.real);
            if (!target || target.kind === 'link')
                refuse(`${load.label}/${node.name}`, 'leads to a path that is no node');
            if (target.kind === 'file') total += target.size;
        }
    }
    dir.size = total;

    return total;
}

/**
 * Loads a version of a project.
 *
 * @param version - Version of the index, its date a real YYYY-MM-DD day from 1970 and its root a folder named like it
 * @param type - Name of the type that holds the project
 * @param project - Name of the project
 * @returns The version with its folders measured and its nodes recorded by path, '' being the version folder
 */
function loadVersion(version: IndexVersion, type: string, project: string): CatalogVersion {
    const label = `${type}/${project}/${version.name}`;
    const released = typeof version.date === 'string' ? parseDay(version.date) : null;
    if (released === null || released < 0) refuse(label, 'has a release date that is no YYYY-MM-DD day from 1970');
    if (version.root?.kind !== 'dir' || version.root.name !== version.name) {
        refuse(label, 'has no root folder named like the version');
    }

    const load: Load = { label, nodes: new Map() };
    const root: CatalogDir = { kind: 'dir', name: version.name, size: 0, entries: [] };
    load.nodes.set('', root);
    root.entries = loadEntries(version.root.entries, '', load);
    measure(root, load);

    return { type, project, name: version.name, date: version.date, released, root, nodes: load.nodes };
}

/**
 * Loads a project of a type, its versions in ascending semver order, and derives its latest version.
 *
 * @param project - Project of the index, whose name must be one that isProjectName accepts
 * @param type - Name of the type that holds the project
 * @returns The project, its latest being the newest release, or the newest pre-release when it has no release
 */
function loadProject(project: IndexProject, type: string): CatalogProject {
    const where = `${type}/${project.name}`;
    let deprecated: Deprecation | undefined;
    if (project.deprecated !== undefined) {
        deprecated = parseDeprecation(project.deprecated) ?? refuse(where, 'has a deprecation notice that is refused');
    }

    const versions = new Map<string, CatalogVersion>();
    let release: CatalogVersion | undefined;
    let last: CatalogVersion | undefined;
    for (const version of project.versions) {
        if (typeof version?.name !== 'string' || !isVersion(version.name)) {
            refuse(where, `holds the version ${JSON.stringify(version?.name)}, which is no X.Y.Z or X.Y.Z-tag`);
        }
        if (last !== undefined && compareVersions(last.name, version.name) >= 0) {
            refuse(where, `lists ${version.name} after ${last.name}, versions must be unique and in semver order`);
        }

        last = loadVersion(version, type, project.name);
        versions.set(last.name, last);
        if (isRelease(last.name)) release = last;
    }
    if (last === undefined) refuse(where, 'has no version');

    return { name: project.name, deprecated, versions, latest: release ?? last };
}

/**
 * Loads a type with its projects.
 *
 * @param type - Type of the index, whose projects must be unique and in ascending UTF-8 byte order
 * @returns The type, its projects in the same order
 */
function loadType(type: IndexType): CatalogType {
    if (typeof type?.name !== 'string' || !isName(type.name)) {
        refuse('the index', `holds the name ${JSON.stringify(type?.name)}, which a type cannot have`);
    }

    const projects = new Map<string, CatalogProject>();
    let previous: string | undefined;
    for (const project of type.projects) {
        if (typeof project?.name !== 'string' || !isProjectName(project.name)) {
            refuse(`type ${type.name}`, `holds the name ${JSON.stringify(project?.name)}, which a project cannot have`);
        }

        if (previous !== undefined && compareBytes(previous, project.name) >= 0) {
            refuse(`type ${type.name}`, `lists ${project.name} after ${previous}, names must be unique and ascending`);
        }
        previous = project.name;
        projects.set(project.name, loadProject(project, type.name));
    }

    return { name: type.name, projects };
}

/**
 * Loads a packages index into the lookups the routes read, without touching the disk.
 * Everything the core relies on is checked here, so a route never meets a state that scan cannot produce: names that a
 * route can match, unique and in order, versions in semver order, projects with at least one version, real days,
 * hashes and sizes, and links that lead to a node. The first fault throws an error that names its place.
 *
 * @param index - Index of format 2, as scan builds it or as a file holds it; another format throws
 * @returns The types of the index by name, then their projects and their versions by name, in index order, each
 * project with its latest version, each version with its folders measured and its nodes by path
 */
export function loadIndex(index: Index): Catalog {
    if (index?.format !== 2) throw new Error(`Unsupported packages index format: ${String(index?.format)}`);

    const types = new Map<string, CatalogType>();
    let previous: string | undefined;
    for (const type of index.types) {
        const loaded = loadType(type);
        if (previous !== undefined && compareBytes(previous, loaded.name) >= 0) {
            refuse('the index', `lists the type ${loaded.name} after ${previous}, names must be unique and ascending`);
        }
        previous = loaded.name;
        types.set(loaded.name, loaded);
    }

    return { types };
}

/**
 * Looks up a project of a package type.
 *
 * @param catalog - Catalog from loadIndex()
 * @param type - Untrusted package type from the URL
 * @param name - Untrusted project name from the URL
 * @returns The project, or undefined if the type or the project does not exist
 */
export function getProject(catalog: Catalog, type: string, name: string): CatalogProject | undefined {
    return catalog.types.get(type)?.projects.get(name);
}

/**
 * Searches packages by project name or package type, case-insensitively.
 * A project matches when its name contains the query, or when the query is exactly
 * its type, in which case every project of that type is returned.
 *
 * @param catalog - Catalog from loadIndex()
 * @param query - Text matched in any case, an empty query matching every project
 * @returns Matching packages with type, name, versions and url, name matches first, the versions starting with the
 * latest alias
 */
export function searchPackages(catalog: Catalog, query: string): SearchResult[] {
    const named: SearchResult[] = [];
    const typed: SearchResult[] = [];
    const q = query.toLowerCase();
    for (const [type, { projects }] of catalog.types) {
        const typeMatch = type.toLowerCase() === q;
        for (const [name, project] of projects) {
            const nameMatch = name.toLowerCase().includes(q);
            if (!nameMatch && !typeMatch) continue;

            const result: SearchResult = {
                type,
                name,
                versions: ['latest', ...project.versions.keys()],
                url: `/${type}/${name}`,
                deprecated: project.deprecated,
            };

            (nameMatch ? named : typed).push(result);
        }
    }

    return [...named, ...typed];
}

/**
 * Counts the total number of packages across all types.
 *
 * @param catalog - Catalog from loadIndex()
 * @returns Number of projects across all types
 */
export function countPackages(catalog: Catalog): number {
    let count = 0;
    for (const { projects } of catalog.types.values()) count += projects.size;

    return count;
}

// A partial version is a major or a major and a minor, as semver.org writes numbers
const PARTIAL = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/;

/**
 * Resolves a partial version to the newest version that starts with it.
 * For example, "3" resolves to "3.5.0" and "3.0" to "3.0.2" when those are the newest matches; an exact version and
 * 'latest' are not partial and are looked up by the caller.
 *
 * @param pattern - Major such as "3", or major and minor such as "3.0"
 * @param project - Project whose versions are searched, in ascending order
 * @returns The newest matching version, a release when one matches, or undefined if the pattern is no partial version
 * or nothing matches
 */
export function resolveVersion(pattern: string, project: CatalogProject): CatalogVersion | undefined {
    if (!PARTIAL.test(pattern)) return undefined;

    const prefix = `${pattern}.`;
    let release: CatalogVersion | undefined;
    let last: CatalogVersion | undefined;
    for (const version of project.versions.values()) {
        if (!version.name.startsWith(prefix)) continue;

        last = version;
        if (isRelease(version.name)) release = version;
    }

    return release ?? last;
}
