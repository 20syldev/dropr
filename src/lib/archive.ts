import { spawn } from 'child_process';
import { join } from 'path';

import type { Response } from 'express';

import { sendError } from './errors.js';

/**
 * Creates and sends a .tar.gz archive of a package version.
 *
 * @param res - Response tar output is piped to, destroyed if the tar process emits 'error' after headers are sent
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

    tar.stderr.on('data', (data: Buffer) => console.error('tar error:', data.toString()));
    tar.on('error', () => {
        if (res.headersSent) return res.destroy();

        sendError(res, 500, 'Archive creation failed.');
    });

    res.on('close', () => tar.kill());

    tar.stdout.pipe(res);
}
