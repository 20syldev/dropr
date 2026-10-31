import fs from 'fs';
import { STATUS_CODES } from 'http';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { createLogger } from '@20syldev/logger.ts';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { sendArchive } from './lib/archive.js';
import { errorBody } from './lib/errors.js';
import { countPackages, loadIndex } from './lib/packages.js';
import { createLimiter } from './lib/ratelimit.js';
import { failure, INTERNAL, json, route } from './lib/route.js';
import { getManifest } from './manifest.js';
import { scan } from './scan.js';
import type { ArchiveBody, FileBody, RouteResponse } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// PACKAGES_DIR serves another tree than packages/, as the tests do with a generated one
const packagesDir = process.env.PACKAGES_DIR ? resolve(process.env.PACKAGES_DIR) : join(rootDir, 'packages');

const app = express();
const logger = createLogger({ theme: 'colored', order: 'desc' });
const pkg = JSON.parse(fs.readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const port = Number(process.env.PORT ?? 4000);
const startTime = Date.now();
const limiter = createLimiter(startTime);

// Published versions are frozen, so the tree is read once and every package route answers from memory
const catalog = loadIndex(scan(packagesDir));

/**
 * Identifies the client behind the reverse proxies.
 * The proxy rewrites CF-Connecting-IP on every request, so it cannot be spoofed by the client, unlike the leftmost
 * X-Forwarded-For entry.
 *
 * @param req - Request read for its CF-Connecting-IP header, then req.ip and the socket address as fallbacks
 * @returns The client address, or an empty string if unknown
 */
function clientOf(req: Request): string {
    const header = req.headers['cf-connecting-ip'];
    if (typeof header === 'string' && header.length > 0) return header;

    return req.ip || req.socket.remoteAddress || '';
}

/**
 * Sends a package file through send, which adds the Range, conditional and HEAD handling of 3.3.1.
 * The path is the real one from the index, so send never resolves a link again.
 *
 * @param res - Response holding the headers of the file route, its ETag and Last-Modified kept by send
 * @param body - File body, its path relative to packagesDir and its messages used when sending fails
 */
function sendPackageFile(res: Response, body: FileBody): void {
    res.sendFile(body.path, { root: packagesDir, dotfiles: 'allow' }, (error) => {
        if (!error) return;
        if (res.headersSent) return void res.destroy();

        // Only a failed stat of send (an fs code, no Accept-Ranges yet) means the file is gone or sealed since startup
        if (!res.hasHeader('Accept-Ranges') && (error as NodeJS.ErrnoException).code) {
            res.removeHeader('X-Content-Type-Options');
        }
        res.removeHeader('ETag');
        res.removeHeader('Cache-Control');
        res.removeHeader('Last-Modified');

        // A range or precondition the file cannot satisfy keeps its status, anything else reads as a missing file
        const { status } = error as Error & { status?: number };
        if (status === 412) return reply(res, failure(412, body.precondition));
        if (status === 416) return reply(res, failure(416, body.range));
        res.removeHeader('Content-Range');
        reply(res, failure(404, body.missing));
    });
}

/**
 * Streams the archive of a version through the tar process.
 *
 * @param res - Response holding the archive headers, set again by sendArchive
 * @param body - Archive body, its key naming the version as type/project/version, 'null' standing for the latest of a
 * project without versions
 */
function streamArchive(res: Response, body: ArchiveBody): void {
    const [type, name, version] = body.key.split('/');

    sendArchive(res, type, name, version, packagesDir);
}

/**
 * Writes a response of the core through Express, which adds Content-Length, the weak JSON ETag, its 304 and HEAD.
 * Headers are set one by one in their order, so the ones already on the response, such as CORS, stay.
 *
 * @param res - Response whose headers are not sent yet
 * @param response - Status, headers and body from route(), json() or failure()
 */
function reply(res: Response, response: RouteResponse): void {
    res.status(response.status);
    for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);

    const { body } = response;
    if (body.kind === 'json') res.send(body.text);
    else if (body.kind === 'empty') res.end();
    else if (body.kind === 'file') sendPackageFile(res, body);
    else streamArchive(res, body);
}

// Behind a reverse proxy, the socket address is the proxy, not the client
app.set('trust proxy', true);

app.use(
    cors({
        methods: ['GET'],
        exposedHeaders: ['Deprecation', 'Link', 'ETag', 'Content-Disposition', 'X-Content-Type-Options'],
    }),
);

// Browsers request /favicon.ico by default, so the ICO (rendered from the SVG mark) is served next to the SVG
app.use('/favicon.ico', express.static(join(rootDir, 'public', 'favicon.ico')));
app.use('/favicon.svg', express.static(join(rootDir, 'public', 'favicon.svg')));

app.use('/robots.txt', express.static(join(rootDir, 'robots.txt')));

app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
        logger.request(req, res, { url: req.originalUrl, duration: `${Date.now() - start}ms` });
    });
    next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
    const refusal = limiter.check(clientOf(req), Date.now());
    if (!refusal) return next();

    reply(res, failure(429, refusal));
});

app.get('/health', (req: Request, res: Response) => {
    const uptime = (Date.now() - startTime) / 1000;
    const mem = process.memoryUsage();
    reply(
        res,
        json(200, {
            name: 'dropr',
            status: 'ok',
            version: pkg.version,
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
            packages: countPackages(catalog.packages),
            memory: {
                rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
                heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
            },
        }),
    );
});

app.get('/manifest', (req: Request, res: Response) => {
    reply(res, json(200, getManifest(pkg.version), { 'Cache-Control': 'public, max-age=300' }));
});

// Any other path or method, so a POST to /health or /manifest still gets the 405 of the core
app.use((req: Request, res: Response) => {
    const { headers, method, originalUrl, path, query } = req;

    reply(res, route({ method, target: originalUrl, path, query, headers }, catalog));
});

// Reached by a static file that fails to send or by a fault of the adapter, since the core never throws
app.use((err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;

    if (status >= 500) console.error(err.stack);
    if (res.headersSent) return void res.destroy();

    // Client errors describe the request, server errors may leak internals
    const message = status < 500 ? err.message : INTERNAL;
    reply(res, json(status, errorBody(status, message, STATUS_CODES[status])));
});

// Express 5 hands a listen failure (port taken) to this callback, so it must not report the server as running
app.listen(port, (error) => {
    if (error) throw error;

    console.log(`dropr is running on\n    - http://127.0.0.1:${port}\n    - http://localhost:${port}`);
});
