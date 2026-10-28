import crypto from 'crypto';
import fs from 'fs';
import { join } from 'path';

import type { ChecksumMap } from '../types/index.js';

/**
 * Computes SHA256 checksums for all files in a directory recursively.
 *
 * @param dirPath - Directory to hash, subdirectories included; throws if it cannot be read
 * @param basePath - Prefix stripped from each file path to build the keys, only passed by the recursive calls
 * @returns Map of file paths relative to basePath (no leading slash) to their SHA256 hex digests
 */
export function getFilesSHA256(dirPath: string, basePath: string = dirPath): ChecksumMap {
    const results: ChecksumMap = {};
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const relativePath = fullPath.replace(basePath + '/', '');
        if (entry.isDirectory()) {
            Object.assign(results, getFilesSHA256(fullPath, basePath));
        } else {
            const content = fs.readFileSync(fullPath);
            results[relativePath] = crypto.createHash('sha256').update(content).digest('hex');
        }
    }
    return results;
}
