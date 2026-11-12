import { createLimiter } from '@moxon/limiter';
import type { Refused } from '@moxon/limiter';

import type {
    Answer,
    Asset,
    ByteRange,
    Handler,
    ReadFile,
    Respond,
    ResponderOptions,
    RouteInput,
    RouteResponse,
    Site,
} from '../types/index.js';

import { archiveStream } from './archive.js';
import { CORS_HEADERS, preflight } from './cors.js';
import { conditionsOf, decide } from './http.js';
import { countPackages } from './packages.js';
import { failure, INTERNAL, route } from './route.js';
import { exact, watch } from './stream.js';
import { styleOf, uiOf } from './theme.js';
import { uiResult } from './ui.js';

type Source = ReadableStream<Uint8Array<ArrayBuffer>>;

const MEGABYTE = 1024 * 1024;

/**
 * Formats a size in bytes the way /health writes the memory of the process.
 *
 * @param bytes - Size in bytes
 * @returns The size in megabytes with 2 decimals and the unit
 */
const megabytes = (bytes: number): string => `${(bytes / MEGABYTE).toFixed(2)} MB`;

/**
 * Formats a duration the way /health writes the uptime.
 *
 * @param seconds - Duration in seconds, which may have a fraction
 * @returns The whole hours, minutes and seconds, such as 1h 2m 3s
 */
const clock = (seconds: number): string =>
    `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${Math.floor(seconds % 60)}s`;

/**
 * Identifies the client behind the reverse proxies.
 * A header that the proxy rewrites on every request cannot be spoofed by the client, unlike the leftmost X-Forwarded-For
 * entry.
 *
 * @param request - Request read for the client IP header
 * @param header - Lower-case name of the client IP header, null to leave it out
 * @param address - Address of the connection, which stands for the client when the header is absent or empty
 * @returns The client address, or an empty string if unknown
 */
function clientOf(request: RouteInput, header: string | null, address: string): string {
    return (header && request.headers.get(header)) || address;
}

/**
 * Reads the path of a request URL.
 *
 * @param request - Request whose URL is absolute
 * @returns The pathname as the URL spells it, or null when the URL does not parse
 */
function pathOf(request: RouteInput): string | null {
    try {
        return new URL(request.url).pathname;
    } catch {
        return null;
    }
}

/**
 * Puts the headers that every answer carries before the ones of a response.
 *
 * @param response - Status and headers of the core
 * @returns The headers of the CORS policy, then the ones of the response, which win on a name they share
 */
function withCors({ headers }: Pick<RouteResponse, 'headers'>): Record<string, string> {
    return { ...CORS_HEADERS, ...headers };
}

/**
 * Answers with a file of the read port, opened before any header is decided so that a file that vanished is a 404.
 * A failure after the headers errors the body, which the adapter turns into a closed connection.
 *
 * @param response - The 200 or 206 of the core, its Content-Length the length of the range
 * @param range - Bytes to send, null for an empty file, which is opened all the same and answered empty
 * @param open - Opens the file for the range, rejecting when it cannot be read
 * @param label - Start of the log line of a failure, such as File error on a/b
 * @param missing - Answer sent in place of the file when it cannot be opened
 * @param logger - Where a failure is reported
 * @returns The answer holding the stream, or the one of a missing file
 */
async function fileAnswer(
    response: Pick<RouteResponse, 'status' | 'headers'>,
    range: ByteRange | null,
    open: (range?: ByteRange) => Promise<Source>,
    label: string,
    missing: RouteResponse,
    logger: ResponderOptions['logger'],
): Promise<Answer> {
    const report = (error: Error) => logger.error(`${label}:`, error.message);

    let source;
    try {
        source = await open(range ?? undefined);
    } catch (error) {
        report(error as Error);

        return { status: missing.status, headers: withCors(missing), body: textOf(missing) };
    }

    const headers = withCors(response);
    if (!range) {
        // The file was empty at startup, so nothing of what it holds now is sent
        void source.cancel().catch(() => undefined);

        return { status: response.status, headers, body: null };
    }

    return { status: response.status, headers, body: watch(exact(source, range.end - range.start + 1), report) };
}

/**
 * Reads the text of a response that holds one.
 *
 * @param response - Response of the core, which a JSON or an empty body made
 * @returns The JSON text, or null for an empty body
 */
function textOf({ body }: RouteResponse): string | null {
    return body.kind === 'json' ? body.text : null;
}

/**
 * Makes the answer of a response that holds no stream.
 *
 * @param response - Response of the core, whose body is JSON or empty
 * @param head - True to leave the body out whatever it is, as a HEAD request gets only the headers of the GET
 * @returns The answer, its body the JSON text, or null for an empty body and for a HEAD
 */
function plain(response: RouteResponse, head = false): Answer {
    return { status: response.status, headers: withCors(response), body: head ? null : textOf(response) };
}

/**
 * Makes the 429 of a request that the limiter refused.
 *
 * @param refusal - Refusal of the limiter, whose scope tells which cap was reached
 * @param window - Window of the limiter in seconds, which the message of a client refusal names
 * @returns The response, its Retry-After the whole seconds to wait
 */
function tooMany(refusal: Refused, window: number): RouteResponse {
    const message =
        refusal.scope === 'global'
            ? 'Global rate limit exceeded.'
            : `You have exceeded the limit of ${refusal.limit} request${refusal.limit === 1 ? '' : 's'} per ${window === 1 ? 'second' : `${window} seconds`}.`;

    return failure(429, message, { 'Retry-After': String(refusal.retryAfter) });
}

/**
 * Answers a GET or HEAD of an asset from its validators, like a package file.
 *
 * @param request - Request whose path names the asset, read for its method and its conditional and range headers
 * @param path - Path of the request, the URL the asset is configured at
 * @param asset - Validators, type and opener of the asset
 * @param logger - Where a failure to open the asset is reported
 * @returns The 200, 206, 304, 412 or 416 of the decision, nothing but the headers for a HEAD, and the 404 of a route when
 * the file cannot be opened
 */
async function assetAnswer(
    request: RouteInput,
    path: string,
    asset: Asset,
    logger: ResponderOptions['logger'],
): Promise<Answer> {
    const decision = decide(conditionsOf(request), asset);
    const gone = failure(404, `Route '${path}' does not exist.`);

    if (decision.status === 412) return plain(failure(412, `Precondition failed for '${path}'.`));
    if (decision.status === 416) return plain(failure(416, `Range not satisfiable for '${path}'.`, decision.headers));

    const headers: Record<string, string> = { 'Cache-Control': 'public, max-age=0', ...decision.headers };
    if (decision.status === 304) return { status: 304, headers: withCors({ headers }), body: null };

    headers['Content-Type'] = asset.contentType;
    headers['X-Content-Type-Options'] = 'nosniff';
    const response = { status: decision.status, headers };
    if (request.method === 'HEAD') return { status: response.status, headers: withCors(response), body: null };

    return fileAnswer(response, decision.range, (range) => asset.open(range), `Asset error on ${path}`, gone, logger);
}

/**
 * Turns a response of the core into an answer, opening its file or its archive for a GET.
 *
 * @param response - Response from route() or failure()
 * @param head - True for a HEAD request, which gets the headers of the GET and nothing is opened for it
 * @param read - Read port the file or the entries of the archive come from
 * @param logger - Where a failure of a file or an archive is reported
 * @returns The answer, its body a string, a stream or null
 */
async function answerOf(
    response: RouteResponse,
    head: boolean,
    read: ReadFile,
    logger: ResponderOptions['logger'],
): Promise<Answer> {
    const { body } = response;

    if (body.kind === 'file' && !head) {
        const label = `File error on ${body.path}`;

        return fileAnswer(response, body.range, (range) => read(body.path, range), label, body.missing, logger);
    }
    if (body.kind === 'archive' && !head) {
        const report = (error: Error) => logger.error(`Archive error on ${body.key}:`, error.message);

        return {
            status: response.status,
            headers: withCors(response),
            body: watch(archiveStream(body.entries, read), report),
        };
    }

    return plain(response, head);
}

/**
 * Creates the responder of the server, which holds the limiter and the start time of /health.
 * Two responders never share them. It reads no env nor disk by itself: files come from the read port and the process
 * memory from the option that gives it.
 *
 * @param options - Catalog the package routes answer from, name and version of the server, manifest, read port, assets
 * by pathname, name of the client IP header, rate limit, optional memory reader, logger of the failures, and ui to
 * answer a browser with pages on the paths of the listings
 * @returns The function that answers a request: it never rejects, and the body of the answer is a string, a stream or null
 */
export function createResponder(options: ResponderOptions): Respond {
    const { catalog, read, assets, logger, rateLimit } = options;
    const startTime = Date.now();
    const limiter = createLimiter({
        window: rateLimit.window * 1000,
        client: rateLimit.client,
        global: rateLimit.global ?? undefined,
    });

    const site: Site = {
        manifest: options.manifest,
        health() {
            const memory = options.memory?.();

            return {
                name: options.name,
                status: 'ok',
                version: options.version,
                uptime: clock((Date.now() - startTime) / 1000),
                packages: countPackages(catalog),
                memory: memory && {
                    rss: megabytes(memory.rss),
                    heapUsed: megabytes(memory.heapUsed),
                    heapTotal: megabytes(memory.heapTotal),
                },
            };
        },
    };

    const baseUrl = options.manifest.baseUrl;
    const ui = uiOf(options.ui);
    const pages = ui
        ? {
              catalog,
              site: {
                  name: options.name,
                  version: options.version,
                  baseUrl,
                  style: styleOf(ui.accent),
                  logo: ui.logo,
                  favicon: ui.favicon,
                  docs: ui.docs,
              },
              read,
              logger,
          }
        : null;

    return async (request, address) => {
        try {
            if (request.method === 'OPTIONS') return preflight();

            const head = request.method === 'HEAD';
            const path = pathOf(request);
            if (path !== null && Object.hasOwn(assets, path) && (head || request.method === 'GET')) {
                return await assetAnswer(request, path, assets[path], logger);
            }

            const decision = limiter.check(clientOf(request, options.clientHeader, address), Date.now());
            if (!decision.ok) return plain(tooMany(decision, rateLimit.window));

            const negotiated = pages ? await uiResult(request, pages) : null;
            if (negotiated?.page) {
                const { status, html } = negotiated.page;

                return { status, headers: withCors(negotiated.page), body: head ? null : html };
            }

            const answer = await answerOf(route(request, catalog, site), head, read, logger);

            return negotiated?.vary ? { ...answer, headers: { ...answer.headers, Vary: 'Accept' } } : answer;
        } catch (error) {
            logger.error((error as Error).stack);

            return plain(failure(500, INTERNAL));
        }
    };
}

/**
 * Creates the handler of the server for a runtime that speaks fetch.
 * It is the responder with its answer put in a Response, so the same code serves a Node server, a worker or a test.
 *
 * @param options - Same options as createResponder
 * @returns The function that answers a request, a Request or any object with a method, a URL and headers; its second
 * argument is the address of the connection, which stands for the client when the IP header is absent
 */
export function createHandler(options: ResponderOptions): Handler {
    const respond = createResponder(options);

    return async (request, address = '') => {
        const { status, headers, body } = await respond(request, address);

        return new Response(body, { status, headers });
    };
}
