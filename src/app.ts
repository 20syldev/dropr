import { STATUS_CODES } from 'http';
import { Readable } from 'stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';

import cors from 'cors';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';

import { createReader } from './disk.js';
import { archiveStream } from './lib/archive.js';
import { errorBody } from './lib/errors.js';
import { countPackages, loadIndex } from './lib/packages.js';
import { createLimiter } from './lib/ratelimit.js';
import { failure, INTERNAL, json, route } from './lib/route.js';
import { exact } from './lib/stream.js';
import { buildManifest } from './manifest.js';
import type {
    AppDeps,
    ArchiveBody,
    Config,
    FileBody,
    Logger,
    ReadFile,
    RouteInput,
    RouteResponse,
} from './types/index.js';

interface Context {
    read: ReadFile;
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

// Scheme and authority that an absolute-form target holds before its path, cut off whatever the authority looks like
const ORIGIN = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i;

/**
 * Builds the request that the core routes from an Express request.
 * The URL is rebuilt on a fixed origin, so Host and X-Forwarded-Host never reach the routing, and the path is
 * concatenated rather than resolved, so a '//npm/lib' keeps its empty segment instead of naming a host.
 *
 * @param req - Express request, read for its method, its raw target and its headers
 * @returns The method, a URL on http://localhost holding the path and the query of the target, an absolute-form target
 * losing its scheme and authority, and the headers, which Node has already checked, so none of them is refused
 */
function requestOf(req: Request): RouteInput {
    const { method, originalUrl } = req;
    const origin = ORIGIN.exec(originalUrl);
    const rest = origin ? originalUrl.slice(origin[0].length) : originalUrl;
    const target = rest.startsWith('/') ? rest : `/${rest}`;

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        for (const item of Array.isArray(value) ? value : [value]) {
            if (item !== undefined) headers.append(name, item);
        }
    }

    return { method, url: `http://localhost${target}`, headers };
}

/**
 * Writes the status and the headers of a response, after the ones already on it, such as CORS.
 *
 * @param res - Response whose headers are not sent yet
 * @param response - Status and headers from route(), json() or failure()
 */
function start(res: Response, { status, headers }: RouteResponse): void {
    res.statusCode = status;
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
}

/**
 * Sends the bytes of a stream as the body of a response, which has its headers sent.
 * The stream is read as fast as the client takes it, one chunk at a time, and cancelled when the client goes away. A
 * failure resets the connection, so a client never takes a body that was cut for a whole one.
 *
 * @param res - Response to end with the stream
 * @param source - Body bytes, which the response must not outlive
 * @param fail - Reports the error of the stream, which is not the client leaving
 */
function pump(res: Response, source: ReadableStream<Uint8Array<ArrayBuffer>>, fail: (error: Error) => void): void {
    // The DOM ReadableStream of the main tsconfig and the one of stream/web differ only in their BYOB reader types
    const stream = Readable.fromWeb(source as NodeReadableStream<Uint8Array>);

    stream.on('error', (error) => {
        fail(error);

        // A reset, unlike a plain close, still reads as a failure when the connection end frames the body (HTTP/1.0)
        if (res.socket) res.socket.resetAndDestroy();
        else res.destroy();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
}

/**
 * Streams a package file, or a range of it, from the read port.
 * The file is opened before any header is written, so a file that vanished or got sealed since startup answers the 404
 * of a missing file, with the headers of the project and none of the file. A failure after the headers resets the
 * connection.
 *
 * @param res - Response whose headers are not sent yet
 * @param response - The 200 or 206 of the core, its Content-Length the length of the range
 * @param body - File body: its path relative to the packages root, its range (null for an empty file, which is opened
 * all the same and answered empty), and the 404 to send in its place
 * @param context - Read port and logger of a failure
 */
async function streamFile(res: Response, response: RouteResponse, body: FileBody, context: Context): Promise<void> {
    const length = body.range ? body.range.end - body.range.start + 1 : 0;
    const fail = (error: Error) => context.logger.error(`File error on ${body.path}:`, error.message);

    let source;
    try {
        source = await context.read(body.path, body.range ?? undefined);
    } catch (error) {
        fail(error as Error);

        return reply(res, body.missing, context);
    }
    if (res.destroyed) return void source.cancel().catch(() => undefined);

    start(res, response);
    if (length > 0) return pump(res, exact(source, length), fail);

    // The file was empty at startup, so nothing of what it holds now is sent
    void source.cancel().catch(() => undefined);
    res.end();
}

/**
 * Streams the archive of a version from the tar writer, once its 200 headers are sent.
 * Any failure after them resets the connection, so a client never takes a cut archive for a whole one.
 *
 * @param res - Response holding the archive headers, flushed before any file is read
 * @param body - Archive body, its key naming the version in the log of a failure
 * @param context - Read port the files are read from, and the logger of a failure
 */
function streamArchive(res: Response, body: ArchiveBody, context: Context): void {
    res.flushHeaders();

    pump(res, archiveStream(body.entries, context.read), (error) => {
        context.logger.error(`Archive error on ${body.key}:`, error.message);
    });
}

/**
 * Writes a response of the core, whose headers hold every validator, length and range of it: Express adds none.
 * Headers are set one by one in their order, so the ones already on the response, such as CORS, stay. A HEAD request
 * gets the headers of the GET answer and no body, so no file is read for it.
 *
 * @param res - Response whose headers are not sent yet
 * @param response - Status, headers and body from route(), json() or failure()
 * @param context - Read port the package files are read from, and the logger of a failure
 */
function reply(res: Response, response: RouteResponse, context: Context): void {
    const { body } = response;
    const head = res.req.method === 'HEAD';

    if (body.kind === 'file' && !head) return void streamFile(res, response, body, context);

    start(res, response);
    if (head || body.kind === 'empty') return void res.end();
    if (body.kind === 'json') return void res.end(body.text);
    if (body.kind === 'archive') streamArchive(res, body, context);
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
    const context: Context = { read: deps.read ?? createReader(packagesDir), logger };
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
                packages: countPackages(catalog),
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
        reply(res, route(requestOf(req), catalog), context);
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
