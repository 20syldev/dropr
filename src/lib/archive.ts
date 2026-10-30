import { spawn } from 'child_process';
import { join } from 'path';

import type { Response } from 'express';

import { sendError } from './errors.js';

/**
 * Creates and sends a .tar.gz archive of a package version.
 * The response ends only once tar exits cleanly, so a client never takes an archive missing a file for a whole one.
 *
 * @param res - Response tar output is streamed to; answered with a 500 when tar fails before any byte is sent, its
 * connection reset when tar fails after
 * @param type - Package type directory under rootDir (e.g. 'npm', 'bash')
 * @param name - Project directory, also the prefix of the archive file name
 * @param version - Exact version directory, already resolved (never 'latest' or a range)
 * @param rootDir - Packages root, laid out as rootDir/type/name/version
 */
export function sendArchive(res: Response, type: string, name: string, version: string, rootDir: string): void {
    const archiveName = `${name}-${version}.tar.gz`;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

    const tar = spawn('tar', ['-czf', '-', '-C', join(rootDir, type, name), version]);
    let closed = false;

    tar.stderr.on('data', (data: Buffer) => console.error('tar error:', data.toString()));

    // A spawn failure (tar missing) is followed by 'close', which settles the response
    tar.on('error', (error) => console.error('tar error:', error.message));

    tar.on('close', (code) => {
        if (closed) return;
        if (code === 0) return void res.end();

        if (!res.headersSent) {
            res.removeHeader('Content-Disposition');
            return sendError(res, 500, 'Archive creation failed.');
        }

        // A reset, unlike a plain close, still reads as a failure when the connection end frames the body (HTTP/1.0)
        if (res.socket) res.socket.resetAndDestroy();
        else res.destroy();
    });

    res.on('close', () => {
        closed = true;
        tar.kill();
    });

    tar.stdout.pipe(res, { end: false });
}
