import assert from 'assert/strict';
import fs from 'fs';
import { after, before, describe, test } from 'node:test';
import { join } from 'path';

import { buildManifest } from '../dist/manifest.js';
import { loadIndex } from '../dist/lib/packages.js';
import { createHandler, createResponder } from '../dist/lib/respond.js';
import { scan } from '../dist/scan.js';

import { createFixture } from './fixture.mjs';
import { chunked, eventually, memoryPort } from './port.mjs';
import { sha256 } from './server.mjs';
import { collect } from './tar.mjs';

const FILE = '/npm/lib@1.2.0/index.js';
const MANIFEST = buildManifest({ baseUrl: 'https://cdn.example.com', params: {}, routes: {} }, 'dropr', '9.9.9');

let fixture;
let catalog;

before(() => {
    fixture = createFixture();
    catalog = loadIndex(scan(fixture.packagesDir, { error() {} }));
});

after(() => fixture.remove());

/**
 * Builds the request that a responder takes.
 *
 * @param path - Request target, GET and without headers by default
 * @param method - HTTP method
 * @param headers - Request headers
 * @returns The method, the URL on http://localhost and the headers
 */
function ask(path, method = 'GET', headers = {}) {
    return { method, url: `http://localhost${path}`, headers: new Headers(headers) };
}

/**
 * Builds an asset held in memory that counts how often it is opened.
 *
 * @param text - Content of the asset
 * @param contentType - Type that the extension of its file gives, plain text by default
 * @returns The asset, with its SHA-256 as strong tag, a fixed modification time, and opened counting its opens
 */
function asset(text, contentType = 'text/plain; charset=utf-8') {
    const bytes = Buffer.from(text);
    const made = {
        etag: `"${sha256(bytes)}"`,
        lastModified: Date.UTC(2025, 4, 1),
        size: bytes.length,
        contentType,
        opened: 0,
        open: async (range) => {
            made.opened++;

            return chunked(range ? bytes.subarray(range.start, range.end + 1) : bytes);
        },
    };

    return made;
}

/**
 * Builds a responder over the packages of the fixture, with a logger that records the errors.
 *
 * @param change - Options that replace the default ones
 * @returns The responder, the logged errors and the options it was made with
 */
function build(change = {}) {
    const errors = [];
    const options = {
        catalog,
        name: 'dropr',
        version: '9.9.9',
        manifest: MANIFEST,
        read: memoryPort((path) => fs.readFileSync(join(fixture.packagesDir, path))),
        assets: {},
        clientHeader: null,
        rateLimit: { window: 10, client: 100, global: 1000 },
        logger: { error: (...args) => errors.push(args) },
        ...change,
    };

    return { respond: createResponder(options), errors, options };
}

/**
 * Builds a stream that gives some bytes and then fails.
 *
 * @param message - Message of the error that ends the stream
 * @returns A stream whose first pull gives 4 bytes and whose second pull errors
 */
function cutAfterFour(message) {
    let pulled = 0;

    return new ReadableStream(
        {
            pull(controller) {
                if (pulled++ === 0) controller.enqueue(new Uint8Array(4));
                else controller.error(new Error(message));
            },
        },
        { highWaterMark: 0 },
    );
}

/**
 * Reads the body of an answer to its end.
 *
 * @param answer - Answer whose body is a string, a stream or null
 * @returns The text of the body, empty for null
 */
async function textOf({ body }) {
    if (body === null) return '';

    return typeof body === 'string' ? body : (await collect(body)).toString();
}

describe('createResponder', () => {
    test('answers every OPTIONS with the preflight, before the rate limit, on any path', async () => {
        const { respond } = build();
        let answer;

        for (let i = 0; i < 150; i++) answer = await respond(ask('/health', 'OPTIONS'), 'a');

        assert.equal(answer.status, 204);
        assert.equal(answer.body, null);
        assert.equal(answer.headers['Access-Control-Allow-Methods'], 'GET, HEAD');
        assert.equal(answer.headers['Access-Control-Max-Age'], '86400');
        assert.equal(answer.headers['Content-Length'], undefined);
        assert.equal((await respond(ask('/nope/at/all', 'OPTIONS'), 'a')).status, 204);
    });

    test('allows GET, HEAD and the range headers, and exposes the validators [change: cors]', async () => {
        const { respond } = build();
        const { headers } = await respond(ask('/', 'OPTIONS'), 'a');
        const list = (name) => headers[name].split(', ');

        assert.equal(headers['Access-Control-Allow-Origin'], '*');
        assert.deepEqual(list('Access-Control-Allow-Headers'), [
            'If-Match',
            'If-Modified-Since',
            'If-None-Match',
            'If-Range',
            'If-Unmodified-Since',
            'Range',
        ]);
        for (const name of ['ETag', 'Content-Range', 'Accept-Ranges', 'Content-Disposition', 'Link', 'Deprecation']) {
            assert.ok(list('Access-Control-Expose-Headers').includes(name), name);
        }
    });

    test('puts the CORS headers on every kind of answer', async () => {
        const { respond } = build({ assets: { '/robots.txt': asset('ok\n') } });
        const paths = [FILE, '/', '/nope', '/health', '/robots.txt', '/npm/lib@1.2.0?download'];

        for (const path of paths) {
            const { headers } = await respond(ask(path), 'a');
            assert.equal(headers['Access-Control-Allow-Origin'], '*', path);
            assert.match(headers['Access-Control-Expose-Headers'], /^Accept-Ranges, /, path);
        }
        assert.equal((await respond(ask('/', 'POST'), 'a')).headers['Access-Control-Allow-Origin'], '*');
    });

    test('puts the CORS headers on every answer about an asset', async () => {
        const robots = asset('0123456789');
        const { respond } = build({ assets: { '/robots.txt': robots } });
        const sent = [
            ['GET', {}, 200],
            ['HEAD', {}, 200],
            ['GET', { 'if-none-match': robots.etag }, 304],
            ['GET', { 'if-match': '"nope"' }, 412],
            ['GET', { range: 'bytes=2-4' }, 206],
            ['GET', { range: 'bytes=99-' }, 416],
        ];

        for (const [method, headers, status] of sent) {
            const answer = await respond(ask('/robots.txt', method, headers), 'a');
            assert.equal(answer.status, status, `${method} ${JSON.stringify(headers)}`);
            assert.equal(answer.headers['Access-Control-Allow-Origin'], '*', `${status}`);
            assert.ok(answer.headers['Access-Control-Expose-Headers'], `${status}`);
        }
    });

    test('answers /health from the site, the memory reader giving its figures', async () => {
        const memory = () => ({ rss: 1048576, heapUsed: 2097152, heapTotal: 3670016 });
        const { respond } = build({ memory });
        const answer = await respond(ask('/health'), 'a');
        const health = JSON.parse(answer.body);

        assert.equal(answer.status, 200);
        assert.equal(answer.headers['Content-Length'], String(Buffer.byteLength(answer.body)));
        assert.deepEqual(Object.keys(health), ['name', 'status', 'version', 'uptime', 'packages', 'memory']);
        assert.deepEqual([health.name, health.status, health.version], ['dropr', 'ok', '9.9.9']);
        assert.match(health.uptime, /^0h 0m \d+s$/);
        assert.equal(
            health.packages,
            [...catalog.types.values()].reduce((sum, { projects }) => sum + projects.size, 0),
        );
        assert.deepEqual(health.memory, { rss: '1.00 MB', heapUsed: '2.00 MB', heapTotal: '3.50 MB' });
    });

    test('leaves the memory out of /health when no reader is given', async () => {
        const { respond } = build();
        const health = JSON.parse((await respond(ask('/health'), 'a')).body);

        assert.equal('memory' in health, false);
    });

    test('answers /manifest with the manifest it was given, kept for 5 minutes', async () => {
        const { respond } = build();
        const answer = await respond(ask('/manifest'), 'a');

        assert.equal(answer.status, 200);
        assert.equal(answer.headers['Cache-Control'], 'public, max-age=300');
        assert.deepEqual(JSON.parse(answer.body), JSON.parse(JSON.stringify(MANIFEST)));
    });

    test('matches /health and /manifest in lower case only [change: casefold]', async () => {
        const { respond } = build();
        const status = async (path) => (await respond(ask(path), 'a')).status;

        for (const path of ['/HEALTH', '/Health', '/MANIFEST', '/Manifest'])
            assert.equal(await status(path), 404, path);
        assert.equal(await status('/health'), 200);
        assert.equal(await status('/manifest'), 200);
    });

    test('a trailing slash is not the health route nor the manifest route [change: slash]', async () => {
        const { respond } = build();

        for (const path of ['/health/', '/manifest/', '/health//', '/health/x']) {
            const answer = await respond(ask(path), 'a');
            assert.equal(answer.status, 404, path);
            assert.equal(JSON.parse(answer.body).message, `Route '${path}' does not exist.`);
        }
    });

    test('reads the path once, so an encoded health is the health route [change: decoded]', async () => {
        const { respond } = build();

        assert.equal((await respond(ask('/%68ealth'), 'a')).status, 200);
        assert.equal((await respond(ask('/%6danifest'), 'a')).status, 200);
        assert.equal((await respond(ask('/%2568ealth'), 'a')).status, 404);
    });

    test('a POST to /health or /manifest is the 405 of the core with its Allow', async () => {
        const { respond } = build();

        for (const path of ['/health', '/manifest']) {
            const answer = await respond(ask(path, 'POST'), 'a');
            assert.equal(answer.status, 405);
            assert.equal(answer.headers.Allow, 'GET, HEAD, OPTIONS');
        }
    });

    test('names the client by the IP header first and by the address when it is absent or empty', async () => {
        const { respond } = build({ clientHeader: 'x-client' });
        const last = async (headers) => (await respond(ask('/health', 'GET', headers), 'address')).status;

        for (let i = 0; i < 101; i++) assert.equal(await last({ 'x-client': `10.0.0.${i}` }), 200);
        for (let i = 0; i < 100; i++) assert.equal(await last({ 'x-client': 'same' }), 200);
        assert.equal(await last({ 'x-client': 'same' }), 429);
        assert.equal(await last({ 'x-client': 'other' }), 200);

        for (let i = 0; i < 100; i++) assert.equal(await last({ 'x-client': '' }), 200);
        assert.equal(await last({}), 429);
    });

    test('counts the address when no header is set, whatever else is forwarded [change: trust]', async () => {
        const { respond } = build();
        let status;

        for (let i = 0; i < 101; i++) {
            const headers = { 'x-forwarded-for': `10.0.0.${i}`, 'x-real-ip': `10.1.0.${i}` };
            ({ status } = await respond(ask('/health', 'GET', headers), 'address'));
        }

        assert.equal(status, 429);
        assert.equal((await respond(ask('/health'), 'someone else')).status, 200);
    });

    test('refuses with the JSON 429 of the limiter, CORS headers included', async () => {
        const { respond } = build();
        let answer;

        for (let i = 0; i < 101; i++) answer = await respond(ask('/health'), 'a');

        assert.equal(answer.status, 429);
        assert.equal(answer.headers['Access-Control-Allow-Origin'], '*');
        assert.equal(JSON.parse(answer.body).error, 'Too Many Requests');
    });

    test('lets a client through again when its window holds fewer requests than the cap [change: refused]', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
        const { respond } = build({ rateLimit: { window: 10, client: 2, global: null } });
        const status = async () => (await respond(ask('/health'), 'a')).status;

        assert.equal(await status(), 200);
        t.mock.timers.tick(1000);
        assert.equal(await status(), 200);
        for (let i = 0; i < 20; i++) {
            t.mock.timers.tick(400);
            assert.equal(await status(), 429);
        }

        t.mock.timers.tick(1000);
        assert.equal(await status(), 200);
        assert.equal(await status(), 429);
        t.mock.timers.tick(1000);
        assert.equal(await status(), 200);
    });

    test('sends Retry-After with a 429, for the client and for the global cap [change: retry]', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
        const { respond } = build({ rateLimit: { window: 10, client: 1, global: 3 } });
        const send = (client) => respond(ask('/health'), client);

        const first = await send('a');
        assert.equal(first.status, 200);
        assert.equal(first.headers['Retry-After'], undefined);

        t.mock.timers.tick(2500);
        const refused = await send('a');
        assert.equal(refused.status, 429);
        assert.equal(refused.headers['Retry-After'], '8');
        assert.match(refused.headers['Access-Control-Expose-Headers'], /(^|, )Retry-After(,|$)/);
        assert.equal(JSON.parse(refused.body).message, 'You have exceeded the limit of 1 request per 10 seconds.');

        assert.equal((await send('b')).status, 200);
        assert.equal((await send('c')).status, 200);
        t.mock.timers.tick(1000);
        const full = await send('d');
        assert.equal(full.status, 429);
        assert.equal(full.headers['Retry-After'], '7');
        assert.equal(JSON.parse(full.body).message, 'Global rate limit exceeded.');
    });

    test('names a window of one second in the singular and leaves the global cap out when it is null', async () => {
        const { respond } = build({ rateLimit: { window: 1, client: 1, global: null } });

        assert.equal((await respond(ask('/health'), 'a')).status, 200);
        const refused = await respond(ask('/health'), 'a');
        assert.equal(JSON.parse(refused.body).message, 'You have exceeded the limit of 1 request per second.');
        for (let i = 0; i < 2000; i++) assert.equal((await respond(ask('/health'), `c${i}`)).status, 200);
    });

    test('never counts an asset nor a preflight against the limit', async () => {
        const { respond } = build({ assets: { '/robots.txt': asset('ok\n') } });

        for (let i = 0; i < 150; i++) {
            assert.equal((await respond(ask('/robots.txt'), 'a')).status, 200);
            assert.equal((await respond(ask('/health', 'OPTIONS'), 'a')).status, 204);
        }

        assert.equal((await respond(ask('/health'), 'a')).status, 200);
    });

    test('turns a fault of the core into the 500 of every fault, logged with its stack', async () => {
        const memory = () => {
            throw new Error('boom');
        };
        const { respond, errors } = build({ memory });
        const answer = await respond(ask('/health'), 'a');

        assert.equal(answer.status, 500);
        assert.equal(answer.headers['Access-Control-Allow-Origin'], '*');
        assert.equal(JSON.parse(answer.body).message, 'An unexpected error occurred.');
        assert.equal(errors.length, 1);
        assert.match(errors[0][0], /^Error: boom\n/);
    });

    test('keeps each limiter and start time to its own responder', async () => {
        const first = build().respond;
        const second = build().respond;

        for (let i = 0; i < 101; i++) await first(ask('/health'), 'a');

        assert.equal((await first(ask('/health'), 'a')).status, 429);
        assert.equal((await second(ask('/health'), 'a')).status, 200);
    });

    test('counts the uptime of /health from the creation of its own responder', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
        const first = build().respond;
        t.mock.timers.tick(3_600_000 + 120_000 + 3_000);
        const second = build().respond;
        t.mock.timers.tick(5_000);
        const uptime = async (respond) => JSON.parse((await respond(ask('/health'), 'a')).body).uptime;

        assert.equal(await uptime(first), '1h 2m 8s');
        assert.equal(await uptime(second), '0h 0m 5s');
    });
});

describe('createResponder, assets', () => {
    const PATH = '/robots.txt';

    test('serves an asset like a package file, with a strong tag and nosniff [change: assets]', async () => {
        const robots = asset('User-agent: *\nDisallow: /\n');
        const { respond } = build({ assets: { [PATH]: robots } });
        const answer = await respond(ask(PATH), 'a');

        assert.equal(answer.status, 200);
        assert.equal(await textOf(answer), 'User-agent: *\nDisallow: /\n');
        const { 'Access-Control-Expose-Headers': exposed, ...headers } = answer.headers;

        assert.ok(exposed);
        assert.deepEqual(headers, {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=0',
            ETag: robots.etag,
            'Last-Modified': 'Thu, 01 May 2025 00:00:00 GMT',
            'Accept-Ranges': 'bytes',
            'Content-Length': String(robots.size),
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
        });
    });

    test('sends the type of the file of the asset, whatever its URL says [change: assets]', async () => {
        const icon = asset('icon', 'image/x-icon');
        const { respond } = build({ assets: { '/icon': icon, '/logo.txt': asset('<svg/>', 'image/svg+xml') } });

        assert.equal((await respond(ask('/icon'), 'a')).headers['Content-Type'], 'image/x-icon');
        assert.equal((await respond(ask('/logo.txt'), 'a')).headers['Content-Type'], 'image/svg+xml');
    });

    test('answers 304 to its tag, 412 to another If-Match, 206 to a range and 416 past the end', async () => {
        const robots = asset('0123456789');
        const { respond } = build({ assets: { [PATH]: robots } });
        const answerTo = (headers) => respond(ask(PATH, 'GET', headers), 'a');

        const same = await answerTo({ 'if-none-match': robots.etag });
        assert.deepEqual([same.status, same.body, same.headers['Content-Length']], [304, null, undefined]);
        assert.equal(same.headers.ETag, robots.etag);

        assert.equal((await answerTo({ 'if-match': '"nope"' })).status, 412);

        const part = await answerTo({ range: 'bytes=2-4' });
        assert.equal(part.status, 206);
        assert.equal(part.headers['Content-Range'], 'bytes 2-4/10');
        assert.equal(await textOf(part), '234');

        const past = await answerTo({ range: 'bytes=99-' });
        assert.equal(past.status, 416);
        assert.equal(past.headers['Content-Range'], 'bytes */10');
    });

    test('answers HEAD with the headers of the GET and opens nothing', async () => {
        const robots = asset('0123456789');
        const { respond } = build({ assets: { [PATH]: robots } });
        const answer = await respond(ask(PATH, 'HEAD', { range: 'bytes=2-4' }), 'a');

        assert.equal(answer.status, 200);
        assert.equal(answer.body, null);
        assert.equal(answer.headers['Content-Length'], '10');
        assert.equal(robots.opened, 0);
    });

    test('answers an empty asset with no body, opening it and releasing it', async () => {
        let cancelled = 0;
        const empty = {
            ...asset(''),
            open: async () => new ReadableStream({ cancel: () => void cancelled++ }),
        };
        const { respond } = build({ assets: { [PATH]: empty } });
        const answer = await respond(ask(PATH), 'a');

        assert.equal(answer.status, 200);
        assert.equal(answer.body, null);
        assert.equal(answer.headers['Content-Length'], '0');
        assert.equal(await eventually(() => cancelled === 1), true);
    });

    test('matches the pathname of an asset exactly [change: assetcase]', async () => {
        const { respond } = build({ assets: { [PATH]: asset('ok\n') } });
        const status = async (path) => (await respond(ask(path), 'a')).status;

        assert.equal(await status('/robots.txt?x=1'), 200);
        for (const path of ['/ROBOTS.TXT', '/Robots.txt', '/robots.txt/', '/%72obots.txt', '//robots.txt']) {
            assert.equal(await status(path), 404, path);
        }
    });

    test('leaves another method than GET and HEAD to the routes, which refuse it', async () => {
        const { respond } = build({ assets: { [PATH]: asset('ok\n') } });
        const answer = await respond(ask(PATH, 'POST'), 'a');

        assert.equal(answer.status, 405);
        assert.equal(answer.headers.Allow, 'GET, HEAD, OPTIONS');
    });

    test('answers the 404 of a route when the asset cannot be opened, and logs it', async () => {
        const broken = { ...asset('ok\n'), open: () => Promise.reject(new Error('gone')) };
        const { respond, errors } = build({ assets: { [PATH]: broken } });
        const answer = await respond(ask(PATH), 'a');

        assert.equal(answer.status, 404);
        assert.equal(JSON.parse(answer.body).message, "Route '/robots.txt' does not exist.");
        assert.deepEqual(errors, [['Asset error on /robots.txt:', 'gone']]);
    });

    test('ends the body with an error and logs it when the asset fails midway', async () => {
        const failing = { ...asset('0123456789'), open: async () => cutAfterFour('cut') };
        const { respond, errors } = build({ assets: { [PATH]: failing } });
        const answer = await respond(ask(PATH), 'a');

        await assert.rejects(textOf(answer));
        assert.deepEqual(errors, [['Asset error on /robots.txt:', 'cut']]);
    });
});

describe('createResponder, files and archives', () => {
    // Wraps a read port and records the paths and ranges it is asked for
    const counting = (port) => {
        const calls = [];

        return { calls, read: (path, range) => (calls.push([path, range]), port(path, range)) };
    };

    const disk = memoryPort((path) => fs.readFileSync(join(fixture.packagesDir, path)));

    test('streams a range of a file from the read port', async () => {
        const { respond } = build();
        const answer = await respond(ask(FILE, 'GET', { range: 'bytes=0-5' }), 'a');

        assert.equal(answer.status, 206);
        assert.equal(await textOf(answer), 'export');
    });

    test('reads nothing for a HEAD of a file or of an archive', async () => {
        const { calls, read } = counting(disk);
        const { respond } = build({ read });

        for (const path of [FILE, '/npm/lib@1.2.0?download', '/download/npm/lib']) {
            const answer = await respond(ask(path, 'HEAD'), 'a');
            assert.equal(answer.status, 200, path);
            assert.equal(answer.body, null, path);
        }

        assert.deepEqual(calls, []);
    });

    test('answers the 404 of a missing file, with the headers of its project, when the port cannot open it', async () => {
        const { respond, errors } = build({ read: () => Promise.reject(new Error('vanished')) });
        const answer = await respond(ask('/npm/old@1.0.0/index.js'), 'a');

        assert.equal(answer.status, 404);
        assert.match(answer.headers.Deprecation, /^@\d+$/);
        assert.equal(answer.headers['Access-Control-Allow-Origin'], '*');
        assert.equal(
            JSON.parse(answer.body).message,
            "File 'index.js' does not exist in the 1.0.0 version of the 'old' project.",
        );
        assert.deepEqual(errors, [['File error on npm/old/1.0.0/index.js:', 'vanished']]);
    });

    test('logs a file that is cut after its headers, and ends its body with an error', async () => {
        const cut = async () => cutAfterFour('disk');
        const { respond, errors } = build({ read: cut });
        const answer = await respond(ask(FILE), 'a');

        assert.equal(answer.status, 200);
        await assert.rejects(textOf(answer));
        assert.deepEqual(errors, [['File error on npm/lib/1.2.0/index.js:', 'disk']]);
    });

    test('logs a file that is shorter than the length it announced', async () => {
        const { respond, errors } = build({ read: async () => chunked(Buffer.from('short')) });
        const answer = await respond(ask(FILE), 'a');

        await assert.rejects(textOf(answer));
        assert.match(errors[0][1], /ended 19 bytes before the expected 24$/);
    });

    test('logs an archive that fails, under the key of its version', async () => {
        const { respond, errors } = build({ read: () => Promise.reject(new Error('unreadable')) });
        const answer = await respond(ask('/npm/lib@1.2.0?download'), 'a');

        assert.equal(answer.status, 200);
        await assert.rejects(textOf(answer));
        assert.deepEqual(errors, [['Archive error on npm/lib/1.2.0:', 'unreadable']]);
    });

    test('does not log a client that leaves, whether a read is pending or not, and cancels the file', async () => {
        for (const pending of [false, true]) {
            let cancelled = false;
            const open = async () =>
                new ReadableStream({
                    pull: (controller) =>
                        pending ? new Promise(() => undefined) : controller.enqueue(new Uint8Array(24)),
                    cancel: () => void (cancelled = true),
                });
            const { respond, errors } = build({ read: open });
            const answer = await respond(ask(FILE), 'a');
            const reader = answer.body.getReader();

            if (pending) void reader.read().catch(() => undefined);
            await eventually(() => false, 20);
            await reader.cancel();
            await new Promise((resolve) => setTimeout(resolve, 20));

            assert.equal(cancelled, true, `pending ${pending}`);
            assert.deepEqual(errors, [], `pending ${pending}`);
        }
    });
});

describe('createHandler', () => {
    test('answers a Request with a Response, a file and its headers', async () => {
        const handler = createHandler(build().options);
        const response = await handler(new Request(`http://localhost${FILE}`));

        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'export default "1.2.0";\n');
        assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
        assert.match(response.headers.get('etag'), /^"[0-9a-f]{64}"$/);
    });

    test('answers a range, a JSON listing, a preflight and a HEAD', async () => {
        const handler = createHandler(build().options);

        const part = await handler(new Request(`http://localhost${FILE}`, { headers: { range: 'bytes=7-13' } }));
        assert.deepEqual([part.status, await part.text()], [206, 'default']);

        const listing = await handler(new Request('http://localhost/npm/lib@1.2.0'));
        assert.equal((await listing.json()).name, 'lib');

        const preflight = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
        assert.deepEqual([preflight.status, await preflight.text()], [204, '']);

        const head = await handler(new Request(`http://localhost${FILE}`, { method: 'HEAD' }));
        assert.deepEqual([head.status, await head.text(), head.headers.get('content-length')], [200, '', '24']);
    });

    test('counts the address given as the client, and the IP header before it', async () => {
        const handler = createHandler({ ...build().options, clientHeader: 'x-client' });
        const send = (headers) => handler(new Request('http://localhost/health', { headers }), 'address');

        for (let i = 0; i < 100; i++) await send({});
        assert.equal((await send({})).status, 429);
        assert.equal((await send({ 'x-client': 'elsewhere' })).status, 200);
    });

    test('takes a plain object as a request, with no address', async () => {
        const handler = createHandler(build().options);
        const response = await handler(ask('/health'));

        assert.equal((await response.json()).status, 'ok');
    });
});
