import crypto from 'crypto';
import fs from 'fs';
import { join, sep } from 'path';

import { parseDay } from './lib/dates.js';
import { parseDeprecation } from './lib/deprecations.js';
import { compareBytes } from './lib/order.js';
import { isName, isProjectName, isSegment, RESERVED } from './lib/router.js';
import { compareVersions, isVersion } from './lib/semver.js';
import type {
    Deprecation,
    ErrorLogger,
    Index,
    IndexDir,
    IndexNode,
    IndexProject,
    IndexType,
    IndexVersion,
} from './types/index.js';

/**
 * Reads the .deprecated.json notice of a project, if any.
 * Like .versions.json, it sits next to the version folders, so listings, archives and checksums never show it.
 *
 * @param projectPath - Project folder, the parent of its version folders
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns The notice, or undefined when the file is missing, unreadable or refused by parseDeprecation, the last two
 * being logged
 */
function readDeprecation(projectPath: string, logger: ErrorLogger): Deprecation | undefined {
    const file = join(projectPath, '.deprecated.json');
    if (!fs.existsSync(file)) return undefined;

    try {
        const notice = parseDeprecation(JSON.parse(fs.readFileSync(file, 'utf-8')));
        if (notice) return notice;

        logger.error(`Invalid deprecation notice in ${file}: expected a YYYY-MM-DD date, a message and a successor.`);
    } catch (error) {
        logger.error(`Error reading ${file}:`, error);
    }

    return undefined;
}

/**
 * Tells whether a release date can be served: a real YYYY-MM-DD day from 1970 to today, UTC.
 * fetch.sh writes the UTC day, so no later day is allowed.
 *
 * @param date - Date read from .versions.json
 * @returns False for any other spelling, a day before the epoch (tar cannot carry it) or a day to come, which no
 * Last-Modified header may announce
 */
function isReleaseDay(date: string): boolean {
    const time = parseDay(date);

    return time !== null && time >= 0 && time <= Date.now();
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
            else logger.error(`Invalid date of ${version} in ${file}: expected a YYYY-MM-DD day, not after today.`);
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
 * @returns The real target relative to root, its segments joined with '/' on every platform, '' for root itself, or
 * undefined when the link dangles, loops or leads out of root
 */
function linkTarget(path: string, root: string): string | undefined {
    try {
        const real = fs.realpathSync(path);
        if (real === root) return '';

        return real.startsWith(root + sep)
            ? real
                  .slice(root.length + 1)
                  .split(sep)
                  .join('/')
            : undefined;
    } catch {
        // ENOENT for a dangling link, ELOOP for a loop: neither has a target to serve
        return undefined;
    }
}

/**
 * Lists the subfolders to read at one level of the tree above the files of a version: types, projects and versions.
 * A hidden entry and a plain file are left out without a word, such as .versions.json or a README next to the projects;
 * a link, a FIFO or any other entry that is no folder is logged, so that nothing vanishes unseen.
 *
 * @param path - Absolute path of the folder to list
 * @param logger - Receives each entry left out and nothing else through its error()
 * @returns The folders in UTF-8 byte order, whatever order the platform lists them in; throws when path cannot be listed
 */
function listFolders(path: string, logger: ErrorLogger): fs.Dirent[] {
    return fs
        .readdirSync(path, { withFileTypes: true })
        .filter((dirent) => {
            if (dirent.name.startsWith('.') || dirent.isFile()) return false;
            if (dirent.isDirectory()) return true;

            logger.error(`Skipping ${join(path, dirent.name)}: not a folder, only folders are read at this level.`);
            return false;
        })
        .sort((a, b) => compareBytes(a.name, b.name));
}

/**
 * Indexes one entry of a folder of a version, a subfolder with everything below it.
 *
 * @param path - Absolute path of the entry
 * @param dirent - Entry as its folder listing gave it, which tells its kind without following a link
 * @param root - Real path of the version folder, which link targets must stay in
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns The node of the entry, or none for a name that no route can match, a file that cannot be hashed or a special
 * file such as a FIFO, a socket or a device, each logged; throws when the entry cannot be stat'ed or listed
 */
function indexEntry(path: string, dirent: fs.Dirent, root: string, logger: ErrorLogger): IndexNode[] {
    const { name } = dirent;
    if (!isSegment(name)) {
        logger.error(`Skipping ${path}: no route can match this name.`);
        return [];
    }

    if (dirent.isDirectory()) return [walkFolder(path, name, root, logger)];
    if (dirent.isFile()) {
        const stat = fs.lstatSync(path);
        const sha256 = hashFile(path, logger);

        return sha256 === null
            ? []
            : [{ kind: 'file', name, size: stat.size, exec: (stat.mode & 0o100) !== 0, sha256 }];
    }
    if (dirent.isSymbolicLink()) {
        const target = fs.readlinkSync(path);
        const real = linkTarget(path, root);

        return [real === undefined ? { kind: 'link', name, target } : { kind: 'link', name, target, real }];
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
 * @returns The folder node, its entries in UTF-8 byte order; an entry or a subfolder that cannot be read is logged and
 * left out, and throws when path itself cannot be listed
 */
function walkFolder(path: string, name: string, root: string, logger: ErrorLogger): IndexDir {
    const entries = fs
        .readdirSync(path, { withFileTypes: true })
        .sort((a, b) => compareBytes(a.name, b.name))
        .flatMap((dirent) => {
            const child = join(path, dirent.name);
            try {
                return indexEntry(child, dirent, root, logger);
            } catch (error) {
                logger.error(`Error reading ${child}:`, error);
                return [];
            }
        });

    return { kind: 'dir', name, entries };
}

/**
 * Indexes a version folder, its files hashed.
 * A version is indexed whole or not at all: it is left out when anything in it could not be read.
 *
 * @param path - Absolute path of the version folder
 * @param name - Version name, the folder name
 * @param date - Release date recorded in .versions.json
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns The version node, or null when a file or folder below it could not be read, or is a special file, which is
 * logged; throws when the version folder cannot be resolved
 */
function scanVersion(path: string, name: string, date: string, logger: ErrorLogger): IndexVersion | null {
    let failures = 0;
    const counter: ErrorLogger = {
        error: (...args) => {
            failures++;
            logger.error(...args);
        },
    };

    let root: IndexDir | undefined;
    try {
        root = walkFolder(path, name, fs.realpathSync(path), counter);
    } catch (error) {
        counter.error(`Error reading ${path}:`, error);
    }
    if (failures > 0 || !root) {
        logger.error(`Skipping version ${path}: it could not be read whole.`);
        return null;
    }

    return { name, date, root };
}

/**
 * Indexes a project folder, its versions sorted by semver.
 * A version needs a folder named X.Y.Z or X.Y.Z-tag and a release date in .versions.json, and a project needs a version.
 *
 * @param path - Absolute path of the project folder, whose subfolders are the versions
 * @param name - Project name, the folder name
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns The project node, or null when none of its versions could be indexed; a folder that is not a version name,
 * a version without a date and a version that cannot be read are each logged and left out; throws when the folder
 * cannot be listed
 */
function scanProject(path: string, name: string, logger: ErrorLogger): IndexProject | null {
    const dates = readDates(path, logger);
    const deprecated = readDeprecation(path, logger);
    const versions = listFolders(path, logger)
        .map((dirent) => dirent.name)
        .filter((version) => {
            if (isVersion(version)) return true;

            logger.error(`Skipping ${join(path, version)}: not a version name, expected X.Y.Z or X.Y.Z-tag.`);
            return false;
        })
        .sort(compareVersions)
        .flatMap((version) => {
            const versionPath = join(path, version);
            const date = dates.get(version);
            if (date === undefined) {
                logger.error(`Skipping version ${versionPath}: no release date in ${join(path, '.versions.json')}.`);
                return [];
            }

            try {
                const indexed = scanVersion(versionPath, version, date, logger);

                return indexed ? [indexed] : [];
            } catch (error) {
                logger.error(`Error reading ${versionPath}:`, error);
                return [];
            }
        });

    if (versions.length === 0) {
        logger.error(`Skipping project ${path}: none of its versions could be indexed.`);
        return null;
    }

    return deprecated ? { name, deprecated, versions } : { name, versions };
}

/**
 * Indexes the projects of a package type.
 *
 * @param typePath - Absolute path of the type folder, whose subfolders are the projects
 * @param logger - Receives each failure this function logs through its error() and nothing else
 * @returns Projects in UTF-8 byte order, empty when the type folder cannot be listed and without a project that cannot
 * be read, whose name isProjectName refuses or that has no version, each logged
 */
function scanProjects(typePath: string, logger: ErrorLogger): IndexProject[] {
    let folders: fs.Dirent[];
    try {
        folders = listFolders(typePath, logger);
    } catch (error) {
        logger.error(`Error reading ${typePath}:`, error);
        return [];
    }

    return folders.flatMap(({ name }) => {
        const path = join(typePath, name);
        if (!isProjectName(name)) {
            logger.error(`Skipping ${path}: not a project name, expected letters, digits, '.', '_' and '-', not list.`);
            return [];
        }

        try {
            const project = scanProject(path, name, logger);

            return project ? [project] : [];
        } catch (error) {
            logger.error(`Error reading ${path}:`, error);
            return [];
        }
    });
}

/**
 * Tells whether a folder name is taken by a route of the server, which would shadow the listing of a type of that name.
 * Names are compared as they are written: the router matches its own in lower case only, so 'Download' and 'Health'
 * stay free, and so does 'Favicon.ico' beside an asset of '/favicon.ico'.
 *
 * @param name - Folder name at the top of the packages tree
 * @param assets - First path segments of the configured assets
 * @returns True when a route of the server or an asset answers the path of that name before the listing of a package
 * type could
 */
export function isReserved(name: string, assets: string[]): boolean {
    return RESERVED.includes(name) || assets.includes(name);
}

/**
 * Indexes a packages tree once, its files hashed, so the routes answer without the disk.
 * Every list is in UTF-8 byte order but the versions, which are in semver order; links keep their raw target next to
 * their real one. What cannot be read, or that no route could serve, is logged and left out, and so is whatever then
 * holds nothing: a version needs a date, a project a version and a type a project.
 *
 * @param root - Packages root, laid out as root/type/project/version, hidden and reserved type names skipped
 * @param logger - Receives each failure and each skipped entry through its error() and nothing else, console by default
 * @param reserved - First path segments of the assets, which no type may take besides the names of the server routes,
 * none by default
 * @returns An index of format 2 that survives a JSON round trip, with no types when root is missing, not a folder or
 * not readable, which is logged; throws when root cannot be listed for any other reason
 */
export function scan(root: string, logger: ErrorLogger = console, reserved: string[] = []): Index {
    let folders: fs.Dirent[];
    try {
        folders = listFolders(root, logger);
    } catch (error) {
        const { code } = error as NodeJS.ErrnoException;
        if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES') throw error;

        logger.error(`No packages folder at ${root}, serving an empty index.`);
        return { format: 2, types: [] };
    }

    const types = folders.flatMap(({ name }): IndexType[] => {
        if (isReserved(name, reserved)) {
            logger.error(`Skipping type '${name}': reserved name.`);
            return [];
        }
        if (!isName(name)) {
            logger.error(`Skipping type '${name}': not a type name, expected letters, digits, '.', '_' and '-'.`);
            return [];
        }

        const projects = scanProjects(join(root, name), logger);
        if (projects.length === 0) {
            logger.error(`Skipping type '${name}': none of its projects could be indexed.`);
            return [];
        }

        return [{ name, projects }];
    });

    return { format: 2, types };
}
