import crypto from 'crypto';
import fs from 'fs';
import { join } from 'path';

import type { CatalogVersion, ChecksumMap, IndexDir } from '../types/index.js';

import { statInside } from './paths.js';

/**
 * Computes SHA256 checksums for all files in a directory recursively.
 * A symlink counts as the file it points to when that file stays inside basePath, as the file route serves it.
 *
 * @param dirPath - Directory to hash, subdirectories included; throws if it or one of its files cannot be read
 * @param basePath - Version folder, prefix stripped from each file path to build the keys, only passed by the
 * recursive calls
 * @returns Map of file paths relative to basePath (no leading slash) to their SHA256 hex digests, without symlinks
 * to folders, to files out of basePath or to nothing
 */
export function getFilesSHA256(dirPath: string, basePath: string = dirPath): ChecksumMap {
    const results: ChecksumMap = {};
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const relativePath = fullPath.replace(basePath + '/', '');
        if (entry.isDirectory()) {
            Object.assign(results, getFilesSHA256(fullPath, basePath));
            continue;
        }

        // A symlinked folder is skipped: its files are hashed under their real path, and it may loop back up
        if (!entry.isFile() && !statInside(basePath, fullPath)?.isFile()) continue;

        const content = fs.readFileSync(fullPath);
        results[relativePath] = crypto.createHash('sha256').update(content).digest('hex');
    }
    return results;
}

/**
 * Adds the SHA-256 of every file below a folder of a version to a map, in pre-order and strcmp order.
 * A link counts as its target file while the target stays inside the version; links to folders are skipped.
 *
 * @param version - Version holding the folder, whose nodes resolve the link targets
 * @param dir - Folder to walk, its subfolders included
 * @param path - Path of dir relative to the version folder, '' for the version folder itself
 * @param results - Map filled in place by assignment, so integer-like keys come first as they did in 3.3.1
 * @returns False when a folder below could not be listed or a file could not be read at scan, leaving results partial
 */
function hashFiles(version: CatalogVersion, dir: IndexDir, path: string, results: ChecksumMap): boolean {
    if (dir.entries === null) return false;

    for (const node of dir.entries) {
        const child = path === '' ? node.name : `${path}/${node.name}`;
        if (node.kind === 'dir') {
            if (!hashFiles(version, node, child, results)) return false;
            continue;
        }

        const target = node.kind === 'link' && node.real !== null ? version.nodes.get(node.real) : node;
        if (target?.kind !== 'file') continue;
        if (target.sha256 === null) return false;

        results[child] = target.sha256;
    }

    return true;
}

/**
 * Reads the SHA-256 of every file of a version from its index, hashed once at startup.
 *
 * @param version - Version whose files are listed, through the links that stay inside it
 * @returns Map of file paths relative to the version folder (no leading slash) to their hex digests, or null when a
 * folder of the version could not be listed or one of its files could not be read
 */
export function checksums(version: CatalogVersion): ChecksumMap | null {
    // Without a prototype, a file named __proto__ is assigned as an own key instead of hitting the prototype setter
    const results: ChecksumMap = Object.create(null);

    return hashFiles(version, version.root, '', results) ? results : null;
}
