import { createHash } from 'crypto';
import fs from 'fs';
import { basename, dirname } from 'path';

import { createReader } from './disk.js';
import { contentType } from './lib/mime.js';
import type { Asset, ErrorLogger } from './types/index.js';

// Bytes hashed at a time, so that an asset is never held whole in memory
const CHUNK = 64 * 1024;

/**
 * Hashes a file with SHA-256, reading it once.
 *
 * @param file - Absolute path of a regular file
 * @returns The lower-case hexadecimal digest of its bytes
 */
function digest(file: string): string {
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(CHUNK);
    const descriptor = fs.openSync(file, 'r');

    try {
        for (let read = fs.readSync(descriptor, buffer); read > 0; read = fs.readSync(descriptor, buffer)) {
            hash.update(buffer.subarray(0, read));
        }
    } finally {
        fs.closeSync(descriptor);
    }

    return hash.digest('hex');
}

/**
 * Reads the validators of the asset files once, so that the core answers them like package files.
 * An asset that cannot be read is logged and left out, so its path falls through to the routes of the server.
 *
 * @param files - Absolute path of the file behind each asset URL
 * @param logger - Receives the failure of each asset through its error() and nothing else
 * @returns The assets by URL, each with the SHA-256 of its bytes as its strong ETag, its modification time, its size,
 * the type that the extension of its file gives and a way to open the file or a range of it
 */
export function scanAssets(files: Record<string, string>, logger: ErrorLogger = console): Record<string, Asset> {
    const assets: Record<string, Asset> = {};

    for (const [url, file] of Object.entries(files)) {
        try {
            const stats = fs.statSync(file);
            if (!stats.isFile()) throw new Error('not a regular file');

            const read = createReader(dirname(file));
            assets[url] = {
                etag: `"${digest(file)}"`,
                lastModified: stats.mtimeMs,
                size: stats.size,
                contentType: contentType(file),
                open: (range) => read(basename(file), range),
            };
        } catch (error) {
            logger.error(`Skipping asset '${url}': ${(error as Error).message}`);
        }
    }

    return assets;
}
