import fs from 'fs';
import { join } from 'path';

import { statInside } from './paths.js';

/**
 * Recursively computes the cumulative size of a directory and indexes it.
 * Sizes are summed on the way back up, so the whole tree is walked only once. Read errors propagate to the caller.
 *
 * @param dirPath - Directory to walk, its path as given becomes its key in the index
 * @param versionDir - Version folder holding dirPath, which a symlink target must stay in to be counted
 * @param index - Map filled with directory paths and their total size in bytes
 * @returns Total size in bytes of the given directory
 */
function indexDirectory(dirPath: string, versionDir: string, index: Map<string, number>): number {
    let total = 0;

    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
            total += indexDirectory(fullPath, versionDir, index);
            continue;
        }

        // A symlink counts as its target file, the same way listings show it; a symlinked folder is not walked twice
        const stat = entry.isSymbolicLink() ? statInside(versionDir, fullPath) : fs.statSync(fullPath);
        if (stat?.isFile()) total += stat.size;
    }
    index.set(dirPath, total);

    return total;
}

/**
 * Builds an in-memory index of cumulative directory sizes for the packages tree.
 * Published versions are immutable, so the index is built once at startup.
 *
 * @param rootDir - Packages root, laid out as rootDir/type/project/version; index keys are joined from it so lookups
 * must use the same base path
 * @returns Map of the version folders and the folders inside them to their cumulative size in bytes, partial or empty
 * when the walk failed
 */
export function getSizes(rootDir: string): Map<string, number> {
    const index = new Map<string, number>();

    // Subfolders of a folder, symlinked ones left out as the package scan does
    const folders = (dir: string) =>
        fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(dir, entry.name));

    try {
        for (const versionDir of folders(rootDir).flatMap(folders).flatMap(folders)) {
            indexDirectory(versionDir, versionDir, index);
        }
    } catch (error) {
        console.error('Error indexing sizes:', error);
    }

    return index;
}
