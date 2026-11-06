import type { IncomingMessage, RequestListener, ServerResponse } from 'http';
import { Readable } from 'stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';

import { createReader } from './disk.js';
import { loadIndex } from './lib/packages.js';
import { createResponder } from './lib/respond.js';
import { buildManifest } from './manifest.js';
import type { AppDeps, Config, Logger, Respond, RouteInput } from './types/index.js';

// Scheme and authority that an absolute-form target holds before its path, cut off whatever the authority looks like
const ORIGIN = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i;

/**
 * Builds the request that the core answers from a Node request.
 * The URL is rebuilt on a fixed origin, so Host and X-Forwarded-Host never reach the routing, and the path is
 * concatenated rather than resolved, so a '//npm/lib' keeps its empty segment instead of naming a host.
 *
 * @param req - Node request, read for its method, its raw target and its headers
 * @returns The method, a URL on http://localhost holding the path and the query of the target, an absolute-form target
 * losing its scheme and authority, and the headers, which Node has already checked, so none of them is refused
 */
function requestOf(req: IncomingMessage): RouteInput {
    const raw = req.url ?? '/';
    const origin = ORIGIN.exec(raw);
    const rest = origin ? raw.slice(origin[0].length) : raw;
    const target = rest.startsWith('/') ? rest : `/${rest}`;

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        for (const item of Array.isArray(value) ? value : [value]) {
            if (item !== undefined) headers.append(name, item);
        }
    }

    return { method: req.method ?? 'GET', url: `http://localhost${target}`, headers };
}

/**
 * Sends the bytes of a stream as the body of a response, whose headers are sent.
 * The stream is read as fast as the client takes it, one chunk at a time, and cancelled when the client goes away. A
 * failure resets the connection, so a client never takes a body that was cut for a whole one.
 *
 * @param res - Response to end with the stream
 * @param source - Body bytes, which the response must not outlive
 */
function pump(res: ServerResponse, source: ReadableStream<Uint8Array<ArrayBuffer>>): void {
    // The DOM ReadableStream of the main tsconfig and the one of stream/web differ only in their BYOB reader types
    const stream = Readable.fromWeb(source as NodeReadableStream<Uint8Array>);

    stream.on('error', () => {
        // A reset, unlike a plain close, still reads as a failure when the connection end frames the body (HTTP/1.0)
        try {
            res.socket?.resetAndDestroy();
        } catch {
            // Only a TCP socket can be reset: a unix socket or a TLS one is closed instead
        }
        res.destroy();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
}

/**
 * Answers one request: the core decides, this writes.
 *
 * @param req - Node request, whose client address is the connection when no IP header names the client
 * @param res - Response to write, logged when its connection closes, which a client may do before the last byte
 * @param respond - Responder of the core
 * @param logger - Receives the request once it is over
 */
async function handle(req: IncomingMessage, res: ServerResponse, respond: Respond, logger: Logger): Promise<void> {
    const start = Date.now();
    res.on('close', () => {
        logger.request({
            method: req.method ?? 'GET',
            url: req.url ?? '/',
            status: res.statusCode,
            duration: Date.now() - start,
        });
    });

    const { status, headers, body } = await respond(requestOf(req), req.socket.remoteAddress ?? '');
    if (res.destroyed) {
        if (body !== null && typeof body !== 'string') void body.cancel().catch(() => undefined);

        return;
    }

    res.statusCode = status;
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);

    if (body === null || typeof body === 'string') return void res.end(body);

    // The headers go out before the first byte is read, so a slow file or archive shows its status at once
    res.flushHeaders();
    pump(res, body);
}

/**
 * Creates the request listener of the server, without reading the env or the disk, nor listening.
 * The counters of the limiter and the start time of /health belong to the listener, so two of them never share them.
 *
 * @param config - Validated config, its port and packagesDir belonging to the entry point
 * @param deps - Index the package routes answer from, absolute folder of the package files, version of dropr, logger of
 * the requests and failures, and optionally the read port and the assets by URL, which scanAssets() makes from
 * config.assets: none are served without them
 * @returns The listener, to give to http.createServer()
 */
export function createApp(config: Config, deps: AppDeps): RequestListener {
    const { index, packagesDir, version, logger } = deps;
    // Published versions are frozen, so the tree is read once and every package route answers from memory
    const catalog = loadIndex(index);
    const respond = createResponder({
        catalog,
        name: config.name,
        version,
        manifest: buildManifest(config.manifest, config.name, version),
        read: deps.read ?? createReader(packagesDir),
        assets: deps.assets ?? {},
        clientHeader: config.clientIp.header,
        memory: process.memoryUsage,
        logger,
    });

    return (req, res) => {
        handle(req, res, respond, logger).catch((error: Error) => {
            logger.error(error.stack);
            res.destroy();
        });
    };
}
