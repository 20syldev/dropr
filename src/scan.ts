import crypto from 'crypto';
import fs from 'fs';
import { join, sep } from 'path';

import { parseDay } from './lib/dates.js';
import { parseDeprecation } from './lib/deprecations.js';
import { compareVersions, EXCLUDED_DIRS, indexNodes } from './lib/packages.js';
import { RESERVED } from './lib/router.js';
import type {
    Deprecation,
    ErrorLogger,
    Index,
    IndexDir,
    IndexNode,
    IndexProject,
    IndexVersion,
} from './types/index.js';

// Milliseconds in a day
const DAY = 86_400_000;

// Names that Express still matches in any case, so a type folder of that name in another case is skipped too
const LENIENT = ['health', 'manifest'];

/**
 * Reads the .deprecated.json notice of a project, if any.
 * Like .versions.json, it sits next to the version folders, so listings, archives and checksums never show it.
 *
 * @param projectPath - Project folder, the parent of its version folders
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns The notice, or null when the file is missing, unreadable or refused by parseDeprecation, the last two
 * being logged
 */
function readDeprecation(projectPath: string, logger: ErrorLogger): Deprecation | null {
    const file = join(projectPath, '.deprecated.json');
    if (!fs.existsSync(file)) return null;

    try {
        const notice = parseDeprecation(JSON.parse(fs.readFileSync(file, 'utf-8')));
        if (notice) return notice;

        logger.error(`Invalid deprecation notice in ${file}: expected a date, a message and a successor.`);
    } catch (error) {
        logger.error(`Error reading ${file}:`, error);
    }

    return null;
}

/**
 * Tells whether a release date can be served: a real YYYY-MM-DD day from 1970 to tomorrow, UTC.
 * Tomorrow is allowed since fetch.sh writes the date of its own time zone when a release has none.
 *
 * @param date - Date read from .versions.json
 * @returns False for any other spelling, a day before the epoch (tar cannot carry it) or past tomorrow, which no
 * Last-Modified header may announce
 */
function isReleaseDay(date: string): boolean {
    const time = parseDay(date);
    const tomorrow = (Math.floor(Date.now() / DAY) + 1) * DAY;

    return time !== null && time >= 0 && time <= tomorrow;
}

/**
 * Reads the release dates that fetch.sh records in the .versions.json of a project.
 * Each version is read on its own: an entry that is not usable is logged and costs only the date of its version.
 *
 * @param projectPath - Project folder, read as projectPath/.versions.json
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns Map of version names to their YYYY-MM-DD date, without the versions whose entry is not an object with a
 * date that isReleaseDay accepts, each logged; an unreadable file is logged and gives no date
 */
function readDates(projectPath: string, logger: ErrorLogger): Map<string, string> {
    const dates = new Map<string, string>();
    const file = join(projectPath, '.versions.json');
    if (!fs.existsSync(file)) return dates;

    try {
        const entries: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
            logger.error(`Invalid ${file}: expected an object of versions.`);
            return dates;
        }

        for (const [version, entry] of Object.entries(entries)) {
            const date = typeof entry === 'object' && entry !== null ? (entry as { date?: unknown }).date : undefined;
            if (typeof date === 'string' && isReleaseDay(date)) dates.set(version, date);
            else logger.error(`Invalid date of ${version} in ${file}: expected a YYYY-MM-DD day, not after tomorrow.`);
        }
    } catch (error) {
        logger.error(`Error reading ${file}:`, error);
    }

    return dates;
}

// Read buffer shared by every hash, since the scan is synchronous
const CHUNK = Buffer.allocUnsafe(1024 * 1024);

/**
 * Hashes a file of a version with SHA-256, read one megabyte at a time so that its size is not limited.
 *
 * @param path - Absolute path of a regular file
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns The lowercase hex digest, or null when the file cannot be read, which is logged
 */
function hashFile(path: string, logger: ErrorLogger): string | null {
    let fd: number | null = null;
    try {
        fd = fs.openSync(path, 'r');
        const hash = crypto.createHash('sha256');
        for (let read = fs.readSync(fd, CHUNK); read > 0; read = fs.readSync(fd, CHUNK)) {
            hash.update(CHUNK.subarray(0, read));
        }

        return hash.digest('hex');
    } catch (error) {
        logger.error(`Error reading ${path}:`, error);
        return null;
    } finally {
        if (fd !== null) fs.closeSync(fd);
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
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns The node of the entry, or none for a special file such as a FIFO, a socket or a device, which is logged;
 * throws when the entry cannot be stat'ed
 */
function indexEntry(path: string, dirent: fs.Dirent, root: string, logger: ErrorLogger): IndexNode[] {
    const stat = fs.lstatSync(path);
    const { name } = dirent;

    if (dirent.isDirectory()) return [walkFolder(path, name, root, logger)];
    if (dirent.isFile()) {
        const exec = (stat.mode & 0o100) !== 0;
        return [{ kind: 'file', name, mtime: stat.mtimeMs, size: stat.size, exec, sha256: hashFile(path, logger) }];
    }
    if (dirent.isSymbolicLink()) {
        const target = fs.readlinkSync(path);
        return [{ kind: 'link', name, target, real: linkTarget(path, root) }];
    }

    logger.error(`Skipping ${path}: not a file, a folder or a link.`);
    return [];
}

/**
 * Indexes a folder of a version and everything below it, without following links.
 *
 * @param path - Absolute path of the folder
 * @param name - Folder name, the version name for the version folder itself
 * @param root - Real path of the version folder, which link targets must stay in
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns The folder node, its entries in strcmp order and its size left to measure, or with null entries and size
 * when it cannot be listed, which is logged; an entry that cannot be stat'ed is logged and left out
 */
function walkFolder(path: string, name: string, root: string, logger: ErrorLogger): IndexDir {
    try {
        const entries = fs.readdirSync(path, { withFileTypes: true }).flatMap((dirent) => {
            const child = join(path, dirent.name);
            try {
                return indexEntry(child, dirent, root, logger);
            } catch (error) {
                logger.error(`Error reading ${child}:`, error);
                return [];
            }
        });

        return { kind: 'dir', name, size: 0, entries };
    } catch (error) {
        logger.error(`Error reading ${path}:`, error);
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
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns The version node; throws when the version folder cannot be stat'ed
 */
function scanVersion(path: string, name: string, date: string | undefined, logger: ErrorLogger): IndexVersion {
    const stat = fs.statSync(path);
    const root = walkFolder(path, name, fs.realpathSync(path), logger);
    const nodes = new Map<string, IndexNode>([['', root]]);
    indexNodes(root, '', nodes);
    measure(root, nodes);

    // Without a date the folder mtime (fetch or checkout) stands in, never later than now so that it is a real day
    const day = new Date(Math.max(0, Math.min(stat.mtimeMs, Date.now()))).toISOString().split('T')[0];

    return { name, date: date ?? day, root };
}

/**
 * Indexes a project folder, its versions sorted by compareVersions.
 *
 * @param path - Absolute path of the project folder, whose subfolders are the versions, symlinked ones left out
 * @param name - Project name, the folder name
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns The project node, without a version that cannot be stat'ed, which is logged; throws when the folder cannot
 * be listed
 */
function scanProject(path: string, name: string, logger: ErrorLogger): IndexProject {
    const versions = fs
        .readdirSync(path, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort(compareVersions);
    const dates = readDates(path, logger);
    const deprecated = readDeprecation(path, logger);
    const scanned = versions.flatMap((version) => {
        const versionPath = join(path, version);
        try {
            return [scanVersion(versionPath, version, dates.get(version), logger)];
        } catch (error) {
            logger.error(`Error reading ${versionPath}:`, error);
            return [];
        }
    });

    const undated = scanned.filter((version) => !dates.has(version.name)).map((version) => version.name);
    if (undated.length > 0) {
        const shown = undated.slice(0, 3).join(', ') + (undated.length > 3 ? ', ...' : '');
        logger.error(
            `No release date in ${join(path, '.versions.json')} for ${shown}, using the date of the version folder.`,
        );
    }

    return { name, deprecated, versions: scanned };
}

/**
 * Indexes the projects of a package type.
 *
 * @param typePath - Absolute path of the type folder, whose subfolders other than 'list' are the projects
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns Projects in strcmp order, empty when the type folder cannot be listed and without a project that cannot be
 * read, both logged
 */
function scanProjects(typePath: string, logger: ErrorLogger): IndexProject[] {
    let dirents: fs.Dirent[];
    try {
        dirents = fs.readdirSync(typePath, { withFileTypes: true });
    } catch (error) {
        logger.error(`Error reading ${typePath}:`, error);
        return [];
    }

    return dirents
        .filter((dirent) => dirent.isDirectory() && dirent.name !== 'list')
        .flatMap((dirent) => {
            const path = join(typePath, dirent.name);
            try {
                return [scanProject(path, dirent.name, logger)];
            } catch (error) {
                logger.error(`Error reading ${path}:`, error);
                return [];
            }
        });
}

/**
 * Tells whether a folder name is taken by a route of the server, which would shadow the listing of a type of that name.
 * The router matches its own names in lower case only, so 'Download' and 'Search' stay free; the routes that Express
 * answers and the assets match in any case. Only the bare path of the type is shadowed for health, manifest and the
 * assets, but the whole folder is skipped, so that the rule is one list.
 *
 * @param name - Folder name at the top of the packages tree
 * @param assets - First path segments of the configured assets, compared in any case
 * @returns True when a route of the server answers the path of that name before the listing of a package type could
 */
function isReserved(name: string, assets: string[]): boolean {
    if (RESERVED.includes(name)) return true;

    const lower = name.toLowerCase();

    return [...LENIENT, ...assets].some((reserved) => reserved.toLowerCase() === lower);
}

/**
 * Indexes a packages tree once, its files hashed and its folders measured, so the routes answer without the disk.
 * Arrays keep the readdir (strcmp) order, mtimes keep their fraction, and links keep their raw target next to their
 * real one; what cannot be read is logged and kept with null entries, size or hash, or left out.
 *
 * @param root - Packages root, laid out as root/type/project/version, hidden, excluded and reserved type names skipped
 * @param logger - Receives each failure and each skipped reserved type through its error() and nothing else, console by
 * default
 * @param reserved - First path segments of the assets, which no type may take besides the names of the server routes,
 * none by default
 * @returns An index of format 1 that survives a JSON round trip, with no types when root is missing, not a folder or
 * not readable, which is logged; throws when root cannot be listed for any other reason
 */
export function scan(root: string, logger: ErrorLogger = console, reserved: string[] = []): Index {
    let dirents: fs.Dirent[];
    try {
        dirents = fs.readdirSync(root, { withFileTypes: true });
    } catch (error) {
        const { code } = error as NodeJS.ErrnoException;
        if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES') throw error;

        logger.error(`No packages folder at ${root}, serving an empty index.`);
        return { format: 1, types: [] };
    }

    const types = dirents
        .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
        .filter(({ name }) => !EXCLUDED_DIRS.includes(name))
        .filter(({ name }) => {
            if (!isReserved(name, reserved)) return true;

            logger.error(`Skipping type '${name}': reserved name.`);
            return false;
        })
        .map(({ name }) => ({ name, projects: scanProjects(join(root, name), logger) }));

    return { format: 1, types };
}
