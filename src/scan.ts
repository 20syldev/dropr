import crypto from 'crypto';
import fs from 'fs';
import { join, sep } from 'path';

import { parseDeprecation } from './lib/deprecations.js';
import { compareVersions, EXCLUDED_DIRS, indexNodes, RESERVED_NAMES } from './lib/packages.js';
import type { Deprecation, Index, IndexDir, IndexNode, IndexProject, IndexVersion } from './types/index.js';

/**
 * Reads the .deprecated.json notice of a project, if any.
 * Like .versions.json, it sits next to the version folders, so listings, archives and checksums never show it.
 *
 * @param projectPath - Project folder, the parent of its version folders
 * @returns The notice, or null when the file is missing, unreadable or refused by parseDeprecation, the last two
 * being logged
 */
function readDeprecation(projectPath: string): Deprecation | null {
    const file = join(projectPath, '.deprecated.json');
    if (!fs.existsSync(file)) return null;

    try {
        const notice = parseDeprecation(JSON.parse(fs.readFileSync(file, 'utf-8')));
        if (notice) return notice;

        console.error(`Invalid deprecation notice in ${file}: expected a date, a message and a successor.`);
    } catch (error) {
        console.error(`Error reading ${file}:`, error);
    }

    return null;
}

/**
 * Reads the release dates that fetch.sh records in the .versions.json of a project.
 *
 * @param projectPath - Project folder, read as projectPath/.versions.json
 * @returns Map of version names to their YYYY-MM-DD date, without the versions whose date is missing or not a string;
 * an unreadable file is logged and keeps only the dates read before the failure
 */
function readDates(projectPath: string): Map<string, string> {
    const dates = new Map<string, string>();
    const file = join(projectPath, '.versions.json');
    if (!fs.existsSync(file)) return dates;

    try {
        const entries = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, { date?: unknown }>;
        for (const [version, entry] of Object.entries(entries)) {
            if (!entry.date) continue;

            if (typeof entry.date === 'string') dates.set(version, entry.date);
            else console.error(`Invalid date of ${version} in ${file}: expected a string.`);
        }
    } catch (error) {
        console.error(`Error reading ${file}:`, error);
    }

    return dates;
}

/**
 * Hashes a file of a version with SHA-256.
 *
 * @param path - Absolute path of a regular file, read whole
 * @returns The lowercase hex digest, or null when the file cannot be read, which is logged
 */
function hashFile(path: string): string | null {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
    } catch (error) {
        console.error(`Error reading ${path}:`, error);
        return null;
    }
}

/**
 * Resolves where a link of a version leads, through every link on the way.
 *
 * @param path - Absolute path of the link
 * @param root - Real path of the version folder, which the target must stay in
 * @returns The real target relative to root, '' for root itself, or null when the link dangles, loops or leads out of
 * root
 */
function linkTarget(path: string, root: string): string | null {
    try {
        const real = fs.realpathSync(path);
        if (real === root) return '';

        return real.startsWith(root + sep) ? real.slice(root.length + 1) : null;
    } catch {
        // ENOENT for a dangling link, ELOOP for a loop: neither has a target to serve
        return null;
    }
}

/**
 * Indexes one entry of a folder of a version, a subfolder with everything below it.
 *
 * @param path - Absolute path of the entry
 * @param dirent - Entry as its folder listing gave it, which tells its kind without following a link
 * @param root - Real path of the version folder, which link targets must stay in
 * @returns The node of the entry, or none for a special file such as a FIFO, a socket or a device, which is logged;
 * throws when the entry cannot be stat'ed
 */
function indexEntry(path: string, dirent: fs.Dirent, root: string): IndexNode[] {
    const stat = fs.lstatSync(path);
    const { name } = dirent;

    if (dirent.isDirectory()) return [walkFolder(path, name, root)];
    if (dirent.isFile()) {
        const exec = (stat.mode & 0o100) !== 0;
        return [{ kind: 'file', name, mtime: stat.mtimeMs, size: stat.size, exec, sha256: hashFile(path) }];
    }
    if (dirent.isSymbolicLink()) {
        const target = fs.readlinkSync(path);
        return [{ kind: 'link', name, target, real: linkTarget(path, root) }];
    }

    console.error(`Skipping ${path}: not a file, a folder or a link.`);
    return [];
}

/**
 * Indexes a folder of a version and everything below it, without following links.
 *
 * @param path - Absolute path of the folder
 * @param name - Folder name, the version name for the version folder itself
 * @param root - Real path of the version folder, which link targets must stay in
 * @returns The folder node, its entries in strcmp order and its size left to measure, or with null entries and size
 * when it cannot be listed, which is logged; an entry that cannot be stat'ed is logged and left out
 */
function walkFolder(path: string, name: string, root: string): IndexDir {
    try {
        const entries = fs.readdirSync(path, { withFileTypes: true }).flatMap((dirent) => {
            const child = join(path, dirent.name);
            try {
                return indexEntry(child, dirent, root);
            } catch (error) {
                console.error(`Error reading ${child}:`, error);
                return [];
            }
        });

        return { kind: 'dir', name, size: 0, entries };
    } catch (error) {
        console.error(`Error reading ${path}:`, error);
        return { kind: 'dir', name, size: null, entries: null };
    }
}

/**
 * Sets the size of a folder of a version and of every folder below it.
 * A link to a file counts as its target while the target stays inside the version, a link to a folder counts nothing.
 *
 * @param dir - Folder to measure, its size and the sizes of its subfolders set in place
 * @param nodes - Nodes of the version by real path, which resolve the link targets
 * @returns Total size in bytes of the files below dir, or null when dir or a folder below it could not be listed
 */
function measure(dir: IndexDir, nodes: Map<string, IndexNode>): number | null {
    if (dir.entries === null) return null;

    let total = 0;
    let complete = true;
    for (const node of dir.entries) {
        if (node.kind === 'dir') {
            const size = measure(node, nodes);
            if (size === null) complete = false;
            else total += size;
            continue;
        }

        const target = node.kind === 'link' && node.real !== null ? nodes.get(node.real) : node;
        if (target?.kind === 'file') total += target.size;
    }
    dir.size = complete ? total : null;

    return dir.size;
}

/**
 * Indexes a version folder, its files hashed and its folders measured.
 *
 * @param path - Absolute path of the version folder
 * @param name - Version name, the folder name
 * @param date - Release date recorded in .versions.json, undefined to use the UTC day of the folder mtime
 * @returns The version node; throws when the version folder cannot be stat'ed
 */
function scanVersion(path: string, name: string, date: string | undefined): IndexVersion {
    const stat = fs.statSync(path);
    const root = walkFolder(path, name, fs.realpathSync(path));
    const nodes = new Map<string, IndexNode>([['', root]]);
    indexNodes(root, '', nodes);
    measure(root, nodes);

    // Versions missing from .versions.json have no recorded date, the folder mtime (fetch or checkout) stands in
    return { name, date: date ?? stat.mtime.toISOString().split('T')[0], root };
}

/**
 * Indexes a project folder, its versions sorted by compareVersions.
 *
 * @param path - Absolute path of the project folder, whose subfolders are the versions, symlinked ones left out
 * @param name - Project name, the folder name
 * @returns The project node, without a version that cannot be stat'ed, which is logged; throws when the folder cannot
 * be listed
 */
function scanProject(path: string, name: string): IndexProject {
    const versions = fs
        .readdirSync(path, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort(compareVersions);
    const dates = readDates(path);

    return {
        name,
        deprecated: readDeprecation(path),
        versions: versions.flatMap((version) => {
            const versionPath = join(path, version);
            try {
                return [scanVersion(versionPath, version, dates.get(version))];
            } catch (error) {
                console.error(`Error reading ${versionPath}:`, error);
                return [];
            }
        }),
    };
}

/**
 * Indexes the projects of a package type.
 *
 * @param typePath - Absolute path of the type folder, whose subfolders other than 'list' are the projects
 * @returns Projects in strcmp order, empty when the type folder cannot be listed and without a project that cannot be
 * read, both logged
 */
function scanProjects(typePath: string): IndexProject[] {
    let dirents: fs.Dirent[];
    try {
        dirents = fs.readdirSync(typePath, { withFileTypes: true });
    } catch (error) {
        console.error(`Error reading ${typePath}:`, error);
        return [];
    }

    return dirents
        .filter((dirent) => dirent.isDirectory() && dirent.name !== 'list')
        .flatMap((dirent) => {
            const path = join(typePath, dirent.name);
            try {
                return [scanProject(path, dirent.name)];
            } catch (error) {
                console.error(`Error reading ${path}:`, error);
                return [];
            }
        });
}

/**
 * Indexes a packages tree once, its files hashed and its folders measured, so the routes answer without the disk.
 * Arrays keep the readdir (strcmp) order, mtimes keep their fraction, and links keep their raw target next to their
 * real one; what cannot be read is logged and kept with null entries, size or hash, or left out.
 *
 * @param root - Packages root, laid out as root/type/project/version, hidden, excluded and reserved type names skipped
 * @returns An index of format 1 that survives a JSON round trip, with no types when root is missing, not a folder or
 * not readable, which is logged; throws when root cannot be listed for any other reason
 */
export function scan(root: string): Index {
    let dirents: fs.Dirent[];
    try {
        dirents = fs.readdirSync(root, { withFileTypes: true });
    } catch (error) {
        const { code } = error as NodeJS.ErrnoException;
        if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES') throw error;

        console.error(`No packages folder at ${root}, serving an empty index.`);
        return { format: 1, types: [] };
    }

    const types = dirents
        .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
        .filter(({ name }) => !EXCLUDED_DIRS.includes(name) && !RESERVED_NAMES.includes(name))
        .map(({ name }) => ({ name, projects: scanProjects(join(root, name)) }));

    return { format: 1, types };
}
