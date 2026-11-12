import fs from 'fs';
import { join } from 'path';

import { loadIndex } from './lib/packages.js';
import { isReserved } from './scan.js';
import type { Index, IndexNode } from './types/index.js';

// Problems that readIndex names in its message, the rest being counted
const SHOWN = 5;

/**
 * Looks at one path of the packages folder without following a link.
 *
 * @param path - Absolute path
 * @returns Its stats, or the problem to report when nothing is there or it cannot be looked at
 */
function inspect(path: string): fs.Stats | string {
    try {
        return fs.lstatSync(path);
    } catch (error) {
        const { code } = error as NodeJS.ErrnoException;

        return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : `cannot be looked at (${code})`;
    }
}

/**
 * Adds to a list the problem of a folder that is not a real folder, a link to one included.
 *
 * @param path - Path of the folder under the packages folder
 * @param root - Absolute packages folder
 * @param problems - List that receives the problem
 * @returns true when the folder is a real folder, so that what it holds can be looked at
 */
function checkFolder(path: string, root: string, problems: string[]): boolean {
    const stats = inspect(join(root, path));
    if (typeof stats === 'string') problems.push(`${path}: ${stats}`);
    else if (!stats.isDirectory()) problems.push(`${path}: not a folder`);
    else return true;

    return false;
}

/**
 * Adds the problems of the files below a folder of an index to a list.
 *
 * @param nodes - Entries of the folder, whose folders are walked
 * @param path - Path of the folder under the packages folder
 * @param root - Absolute packages folder
 * @param problems - List that receives one line per folder or file that is missing, is not what the index says, has
 * another size or cannot be read
 */
function collect(nodes: IndexNode[], path: string, root: string, problems: string[]): void {
    for (const node of nodes) {
        const here = `${path}/${node.name}`;
        if (node.kind === 'dir') {
            if (checkFolder(here, root, problems)) collect(node.entries, here, root, problems);
        } else if (node.kind === 'file') {
            const stats = inspect(join(root, here));
            if (typeof stats === 'string') problems.push(`${here}: ${stats}`);
            else if (!stats.isFile()) problems.push(`${here}: not a regular file`);
            else if (stats.size !== node.size) problems.push(`${here}: ${stats.size} bytes, ${node.size} indexed`);
            else {
                try {
                    fs.accessSync(join(root, here), fs.constants.R_OK);
                } catch {
                    problems.push(`${here}: cannot be read`);
                }
            }
        }
    }
}

/**
 * Lists what a folder lacks of the files that an index describes.
 * Each folder and file is looked at once, without following links, and a file is not read: it must exist as a regular
 * file that can be read, of the size the index gives, below real folders. A change of content that keeps the size is
 * not seen, and a file the index does not list is not looked for.
 *
 * @param index - Index to check
 * @param root - Absolute packages folder, laid out as root/type/project/version
 * @param reserved - First path segments of the assets, which no type may take besides the names of the server routes,
 * none by default
 * @returns One line per type that a server would not serve, and per folder or file that is missing, is not what the
 * index says, has another size or cannot be read; empty when the folder matches
 */
export function verifyIndex(index: Index, root: string, reserved: string[] = []): string[] {
    const problems: string[] = [];

    for (const type of index.types) {
        if (isReserved(type.name, reserved)) {
            problems.push(`${type.name}: reserved name`);
            continue;
        }
        if (!checkFolder(type.name, root, problems)) continue;

        for (const project of type.projects) {
            const projectPath = `${type.name}/${project.name}`;
            if (!checkFolder(projectPath, root, problems)) continue;

            for (const version of project.versions) {
                const versionPath = `${projectPath}/${version.name}`;
                if (checkFolder(versionPath, root, problems))
                    collect(version.root.entries, versionPath, root, problems);
            }
        }
    }

    return problems;
}

/**
 * Reads an index that dropr index wrote and checks it against the packages folder it will be served from.
 *
 * @param file - Absolute path of the index file
 * @param root - Absolute packages folder
 * @param reserved - First path segments of the assets, none by default
 * @returns The index, which loadIndex accepts and whose files the folder holds
 * @throws Error when the file cannot be read or is not JSON, when the core refuses the index, or when the folder lacks
 * files of the index, holds them at another size, or the index has a type that a server would not serve, the message
 * naming the first problems
 */
export function readIndex(file: string, root: string, reserved: string[] = []): Index {
    let index: Index;
    try {
        index = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (error) {
        throw new Error(`Cannot read the index ${file}: ${(error as Error).message}`, { cause: error });
    }
    try {
        loadIndex(index);
    } catch (error) {
        throw new Error(`The index ${file} is not valid: ${(error as Error).message}`, { cause: error });
    }

    const problems = verifyIndex(index, root, reserved);
    if (problems.length > 0) {
        const count = `${problems.length} problem${problems.length === 1 ? '' : 's'}`;
        const more = problems.length > SHOWN ? `\n... and ${problems.length - SHOWN} more` : '';
        const shown = problems.slice(0, SHOWN).join('\n');
        throw new Error(`The index ${file} does not match ${root}, ${count}:\n${shown}${more}\nRun dropr index again.`);
    }

    return index;
}
