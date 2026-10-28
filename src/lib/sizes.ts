import fs from 'fs';
import { join } from 'path';

/**
 * Recursively computes the cumulative size of a directory and indexes it.
 * Sizes are summed on the way back up, so the whole tree is walked only once. Read errors propagate to the caller.
 *
 * @param dirPath - Directory to walk, its path as given becomes its key in the index
 * @param index - Map filled with directory paths and their total size in bytes
 * @returns Total size in bytes of the given directory
 */
function indexDirectory(dirPath: string, index: Map<string, number>): number {
    let total = 0;

    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = join(dirPath, entry.name);
        total += entry.isDirectory() ? indexDirectory(fullPath, index) : fs.statSync(fullPath).size;
    }
    index.set(dirPath, total);

    return total;
}

/**
 * Builds an in-memory index of cumulative directory sizes for the packages tree.
 * Published versions are immutable, so the index is built once at startup.
 *
 * @param rootDir - Packages root, index keys are joined from it so lookups must use the same base path
 * @returns Map of directory paths to their cumulative size in bytes, partial or empty when the walk failed
 */
export function getSizes(rootDir: string): Map<string, number> {
    const index = new Map<string, number>();

    try {
        indexDirectory(rootDir, index);
    } catch (error) {
        console.error('Error indexing sizes:', error);
    }

    return index;
}
