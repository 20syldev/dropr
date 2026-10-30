import crypto from 'crypto';
import fs from 'fs';
import { join } from 'path';

import type { ChecksumMap } from '../types/index.js';

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
