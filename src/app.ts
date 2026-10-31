import fs from 'fs';
import { STATUS_CODES } from 'http';
import { join } from 'path';
import { Readable } from 'stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';

import cors from 'cors';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';

import { archiveStream } from './lib/archive.js';
import { errorBody } from './lib/errors.js';
import { countPackages, loadIndex } from './lib/packages.js';
import { createLimiter } from './lib/ratelimit.js';
import { failure, INTERNAL, json, route } from './lib/route.js';
import { buildManifest } from './manifest.js';
import type { AppDeps, ArchiveBody, Config, FileBody, Logger, RouteResponse } from './types/index.js';

interface Context {
    packagesDir: string;
    logger: Logger;
}

/**
 * Identifies the client behind the reverse proxies.
 * A header that the proxy rewrites on every request cannot be spoofed by the client, unlike the leftmost X-Forwarded-For
 * entry that req.ip falls back to when trust proxy is on.
 *
 * @param req - Request read for the client IP header, then req.ip and the socket address as fallbacks
 * @param name - Lowercase name of the client IP header, null to leave it out
 * @returns The client address, or an empty string if unknown
 */
function clientOf(req: Request, name: string | null): string {
    const header = name && req.headers[name];
    if (typeof header === 'string' && header.length > 0) return header;

    return req.ip || req.socket.remoteAddress || '';
}

/**
 * Sends a package file through send, which adds the Range, conditional and HEAD handling of 3.3.1.
 * The path is the real one from the index, so send never resolves a link again.
 *
 * @param res - Response holding the headers of the file route, its ETag and Last-Modified kept by send
 * @param body - File body, its path relative to packagesDir and its messages used when sending fails
 * @param context - Folder the file is read from, and the logger of the reply
 */
function sendPackageFile(res: Response, body: FileBody, context: Context): void {
    res.sendFile(body.path, { root: context.packagesDir, dotfiles: 'allow' }, (error) => {
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
        if (status === 412) return reply(res, failure(412, body.precondition), context);
        if (status === 416) return reply(res, failure(416, body.range), context);
        res.removeHeader('Content-Range');
        reply(res, failure(404, body.missing), context);
    });
}

/**
 * Streams the archive of a version from the tar writer, once its 200 headers are sent.
 * Any failure after them resets the connection, so a client never takes a cut archive for a whole one.
 * Each file is read whole, so a file of 2 GiB or more fails to read and resets its archive.
 *
 * @param res - Response holding the archive headers, flushed before any file is read; a HEAD request ends there
 * @param body - Archive body, its key naming the version in the log of a failure, its entries null for a version that
 * cannot be archived, which resets at once
 * @param context - Folder the files are read from, and the logger of a failure
 */
function streamArchive(res: Response, body: ArchiveBody, context: Context): void {
    res.flushHeaders();
    if (res.req.method === 'HEAD') return void res.end();

    const abort = new AbortController();
    const read = (source: string) => fs.promises.readFile(join(context.packagesDir, source), { signal: abort.signal });

    // The DOM ReadableStream of the main tsconfig and the one of stream/web differ only in their BYOB reader types
    const stream = Readable.fromWeb(archiveStream(body.entries, read) as NodeReadableStream<Uint8Array>);

    stream.on('error', (error) => {
        context.logger.error(`Archive error on ${body.key}:`, error.message);

        // A reset, unlike a plain close, still reads as a failure when the connection end frames the body (HTTP/1.0)
        if (res.socket) res.socket.resetAndDestroy();
        else res.destroy();
    });

    // A client gone mid-download leaves a whole-file read pending, aborted so its buffer is freed at once
    res.on('close', () => {
        stream.destroy();
        abort.abort();
    });
    stream.pipe(res);
}

/**
 * Writes a response of the core through Express, which adds Content-Length, the weak JSON ETag, its 304 and HEAD.
 * Headers are set one by one in their order, so the ones already on the response, such as CORS, stay.
 *
 * @param res - Response whose headers are not sent yet
 * @param response - Status, headers and body from route(), json() or failure()
 * @param context - Folder the package files are read from, and the logger of a failure
 */
function reply(res: Response, response: RouteResponse, context: Context): void {
    res.status(response.status);
    for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);

    const { body } = response;
    if (body.kind === 'json') res.send(body.text);
    else if (body.kind === 'empty') res.end();
    else if (body.kind === 'file') sendPackageFile(res, body, context);
    else streamArchive(res, body, context);
}

/**
 * Creates the Express app of the server, without reading the env or the disk, nor listening.
 * The counters of the limiter and the start time of /health belong to the app, so two apps never share them.
 *
 * @param config - Validated config, its asset files absolute; its port and packagesDir belong to the entry point
 * @param deps - Index the package routes answer from, absolute folder of the package files, version of dropr, and
 * logger of the requests and failures
 * @returns The app, to give to listen() or to an http server
 */
export function createApp(config: Config, deps: AppDeps): Express {
    const { index, packagesDir, version, logger } = deps;
    const context: Context = { packagesDir, logger };
    const app = express();
    const startTime = Date.now();
    const limiter = createLimiter(startTime);

    // Published versions are frozen, so the tree is read once and every package route answers from memory
    const catalog = loadIndex(index);
    const manifest = buildManifest(config.manifest, config.name, version);

    // Behind a reverse proxy, the socket address is the proxy, not the client
    app.set('trust proxy', config.clientIp.trustProxy);

    app.use(
        cors({
            methods: ['GET'],
            exposedHeaders: ['Deprecation', 'Link', 'ETag', 'Content-Disposition', 'X-Content-Type-Options'],
        }),
    );

    for (const [url, file] of Object.entries(config.assets)) app.use(url, express.static(file));

    app.use((req: Request, res: Response, next: NextFunction) => {
        const start = Date.now();
        res.on('finish', () => {
            logger.request({
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                duration: Date.now() - start,
            });
        });
        next();
    });

    app.use((req: Request, res: Response, next: NextFunction) => {
        const refusal = limiter.check(clientOf(req, config.clientIp.header), Date.now());
        if (!refusal) return next();

        reply(res, failure(429, refusal), context);
    });

    app.get('/health', (req: Request, res: Response) => {
        const uptime = (Date.now() - startTime) / 1000;
        const mem = process.memoryUsage();
        reply(
            res,
            json(200, {
                name: config.name,
                status: 'ok',
                version,
                uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
                packages: countPackages(catalog.packages),
                memory: {
                    rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
                    heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                    heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
                },
            }),
            context,
        );
    });

    app.get('/manifest', (req: Request, res: Response) => {
        reply(res, json(200, manifest, { 'Cache-Control': 'public, max-age=300' }), context);
    });

    // Any other path or method, so a POST to /health or /manifest still gets the 405 of the core
    app.use((req: Request, res: Response) => {
        const { headers, method, originalUrl, path, query } = req;

        reply(res, route({ method, target: originalUrl, path, query, headers }, catalog), context);
    });

    // Reached by a static file that fails to send or by a fault of the adapter, since the core never throws
    app.use((err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
        const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;

        if (status >= 500) logger.error(err.stack);
        if (res.headersSent) return void res.destroy();

        // Client errors describe the request, server errors may leak internals
        const message = status < 500 ? err.message : INTERNAL;
        reply(res, json(status, errorBody(status, message, STATUS_CODES[status])), context);
    });

    return app;
}
