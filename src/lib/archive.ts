import { join } from 'path';
import { spawn } from 'child_process';
import type { Response } from 'express';

/**
 * Creates and sends a .tar.gz archive of a package version.
 *
 * @param res - Express response object
 * @param type - Package type (e.g. 'npm', 'js')
 * @param name - Project name
 * @param version - Version string
 * @param rootDir - Root directory containing packages
 */
export function sendArchive(res: Response, type: string, name: string, version: string, rootDir: string): void {
    const archiveName = `${name}-${version}.tar.gz`;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

    const tar = spawn('tar', ['-czf', '-', '-C', join(rootDir, type, name), version]);

    tar.stderr.on('data', (data: Buffer) => console.error('tar error:', data.toString()));
    tar.on('error', () => {
        if (res.headersSent) return res.destroy();

        res.status(500).jsonResponse({
            message: 'Internal Server Error',
            error: 'Archive creation failed.',
            status: '500',
        });
    });

    res.on('close', () => tar.kill());

    tar.stdout.pipe(res);
}
