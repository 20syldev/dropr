import assert from 'assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import { after, before, describe, test } from 'node:test';
import { join } from 'path';

import { createFixture, isReadable } from './fixture.mjs';
import { request, rootDir, sha256, startServer } from './server.mjs';
import { readArchive } from './tar.mjs';

// Response headers recorded in the snapshots; CORS headers are added for the requests that send an Origin
const HEADERS = [
    'accept-ranges',
    'allow',
    'cache-control',
    'content-disposition',
    'content-length',
    'content-range',
    'content-type',
    'deprecation',
    'etag',
    'last-modified',
    'link',
    'x-content-type-options',
];

// Requests replayed against the generated tree, GET by default; checkout: a repository file, locked: needs 000 modes
const CASES = [
    { path: '/' },
    { path: '/favicon.ico', checkout: true },
    { path: '/favicon.svg', checkout: true },
    { path: '/robots.txt', checkout: true },
    { path: '/search?q=lib' },
    { path: '/search?q=LIB' },
    { path: '/search?q=npm' },
    { path: '/search?q=bash' },
    { path: '/search?q=e' },
    { path: '/search?q=zzz' },
    { path: '/search' },
    { path: '/search?q=%20%20' },
    { path: '/search?q=a&q=b' },
    { path: '/search??q=lib' },
    { path: '/download' },
    { path: '/download/npm' },
    { path: '/download/nope' },
    { path: '/download/npm/lib' },
    { path: '/download/npm/lib@1.2' },
    { path: '/download/npm/lib@9' },
    { path: '/download/npm/nope' },
    { path: '/download/npm/old' },
    { path: '/download/a/b/c' },
    { path: '/Download/npm' },
    { path: '/npm' },
    { path: '/bash' },
    { path: '/config' },
    { path: '/nope' },
    { path: '/node_modules' },
    { path: '/.hidden' },
    { path: '/__proto__' },
    { path: '/constructor' },
    { path: '/NPM' },
    { path: '/npm/' },
    { path: '/npm//lib?x=1' },
    { path: '/npm/lib' },
    { path: '/npm/nope' },
    { path: '/npm/list' },
    { path: '/npm/__proto__' },
    { path: '/npm/lib@latest' },
    { path: '/npm/lib@1' },
    { path: '/npm/lib@1.2' },
    { path: '/npm/lib@1.1' },
    { path: '/npm/lib@1.2.0' },
    { path: '/npm/lib@2' },
    { path: '/npm/lib@2.0.0' },
    { path: '/npm/next@latest' },
    { path: '/npm/old' },
    { path: '/npm/old@latest' },
    { path: '/npm/old@9' },
    { path: '/npm/lib@' },
    { path: '/npm/lib@1.0.0@junk' },
    { path: '/npm/lib/anything/at/all' },
    { path: '/npm/lib@1.2.0?checksums' },
    { path: '/npm/lib@1.2.0?download' },
    { path: '/npm/lib@latest?download' },
    { path: '/npm/lib@1.2.0?download', method: 'HEAD' },
    { path: '/npm/lib@1.2.0??checksums' },
    { path: '/npm/lib@1.2.0?checksums&download' },
    { path: '/npm/lib@1.0.0?checksums' },
    { path: '/npm/links@1.0.0' },
    { path: '/npm/links@1.0.0?checksums' },
    { path: '/npm/links@1.0.0?download' },
    { path: '/npm/links@1.0.0/dist' },
    { path: '/npm/links@1.0.0/dist/loop' },
    { path: '/npm/links@1.0.0/folder' },
    { path: '/npm/links@1.0.0/inside' },
    { path: '/npm/links@1.0.0/folder/file.js' },
    { path: '/npm/links@1.0.0/dist/loop/index.js' },
    { path: '/npm/links@1.0.0/sibling' },
    { path: '/npm/links@1.0.0/outside' },
    { path: '/npm/links@1.0.0/dangling' },
    { path: '/npm/broken@1.0.0?checksums', locked: true },
    { path: '/npm/broken@1.0.0?download', locked: true },
    { path: '/npm/broken@1.0.0/locked.bin', locked: true },
    { path: '/npm/sealed@1.0.0', locked: true },
    { path: '/npm/sealed@1.0.0/vault', locked: true },
    { path: '/npm/sealed@1.0.0/vault/key.txt', locked: true },
    { path: '/npm/sealed@1.0.0/index.js', locked: true },
    { path: '/npm/sealed@1.0.0?checksums', locked: true },
    { path: '/npm/sealed@1.0.0?download', locked: true },
    { path: '/npm/lib/changelog' },
    { path: '/npm/lib/CHANGELOG' },
    { path: '/npm/lib@1.0.0/changelog' },
    { path: '/npm/nope/changelog' },
    { path: '/npm/old/changelog' },
    { path: '/bash/gft/changelog' },
    { path: '/npm/lib@1.2.0/index.js' },
    { path: '/npm/lib@latest/index.js' },
    { path: '/npm/lib@1/package.json' },
    { path: '/npm/lib@1.2.0/dist' },
    { path: '/npm/lib@1.2.0/dist/' },
    { path: '/npm/lib@1.2.0/dist/nested/deep.cjs' },
    { path: '/npm/lib@1.2.0/dist/index.d.ts' },
    { path: '/npm/lib@1.2.0/.npmignore' },
    { path: '/npm/lib@1.2.0/missing.js' },
    { path: '/npm/lib@1.2.0/index.js/x' },
    { path: '/npm/lib@1.2.0/../1.0.0/index.js' },
    { path: '/npm/lib@1.2.0/%2e%2e/%2e%2e/old/1.0.0/index.js' },
    { path: '/npm/lib@1.2.0/..%2F..%2F..%2F..%2Fsecret.txt' },
    { path: '/npm/lib@1.2.0/index.js%00.txt' },
    { path: '/npm/lib@1.2.0/.' },
    { path: '/npm/lib@1.2.0/dist//' },
    { path: '/npm/lib@1.2.0/package.json/' },
    { path: '/npm/lib@1.2.0/../1.2.0/index.js' },
    { path: '/npm/lib@1.2.0/dist\\index.mjs#x' },
    { path: '/npm/lib@1.0.0/index.js' },
    { path: '/npm/old@1.0.0/index.js' },
    { path: '/bash/gft@1.2.0/gft' },
    { path: '/bash/gft@1.2.0/README.md' },
    { path: '/config/styles@1.0.0/theme.css' },
    { path: '/config/styles@1.0.0/logo.svg' },
    { path: '/config/styles@1.0.0/data.json' },
    { path: '/npm/lib@1.2.0/index.js', headers: { range: 'bytes=0-5' } },
    { path: '/npm/lib@1.2.0/index.js', headers: { range: 'bytes=999-' } },
    { path: '/npm/lib@1.2.0/index.js', headers: { 'if-modified-since': 'Wed, 01 Jan 2025 12:00:00 GMT' } },
    { path: '/npm/lib@1.0.0/index.js', headers: { 'if-modified-since': 'Wed, 01 Jan 2025 12:00:00 GMT' } },
    { path: '/npm/lib@1.2.0/index.js', headers: { range: 'bytes=0-5', 'if-range': 'foo' } },
    { path: '/npm/lib@1.2.0/index.js', headers: { range: 'bytes=-6' } },
    { path: '/npm/lib@1.2.0/index.js', headers: { 'if-none-match': '*' } },
    { path: '/npm/lib@1.2.0/index.js', headers: { 'if-match': '"nope"' } },
    { path: '/npm/lib', headers: { 'if-none-match': '*' } },
    { path: '/npm/lib@1.2.0/index.js', headers: { origin: 'https://example.com' } },
    { path: '/npm/lib@1.2.0/index.js', method: 'HEAD' },
    { path: '/%E0%A4%A' },
    { path: '/npm/lib@1.2.0/%E0%A4%A' },
    { path: '/npm/old@1.0.0/%E0%A4%A' },
    { path: '/health', method: 'POST' },
    { path: '/npm/lib', method: 'POST' },
    { path: '/', method: 'PUT' },
    { path: '/npm/lib@1.2.0/index.js', method: 'DELETE' },
    {
        path: '/',
        method: 'OPTIONS',
        headers: { origin: 'https://example.com', 'access-control-request-method': 'GET' },
    },
];

const pkg = JSON.parse(fs.readFileSync(join(rootDir, 'package.json'), 'utf-8'));

/**
 * Tells whether a response holds JSON written by the server rather than a package file.
 * Package files carry X-Content-Type-Options, so a .json file is not server JSON; an error always is, even when it
 * replaces a file that failed to send.
 *
 * @param response - Response from request(), read for its status, Content-Type and X-Content-Type-Options
 * @returns True for a JSON Content-Type on a server answer, whether its body is empty or not
 */
function isServerJson({ status, headers }) {
    const type = headers['content-type'] ?? '';

    return type.startsWith('application/json') && (status >= 400 || !headers['x-content-type-options']);
}

/**
 * Computes the weak ETag that Express gives a body it sends.
 *
 * @param body - Bytes of a non-empty body, as received
 * @returns W/ followed by the quoted length in hex, a dash and the first 27 characters of the base64 SHA-1
 */
function weakEtag(body) {
    const hash = crypto.createHash('sha1').update(body).digest('base64').slice(0, 27);

    return `W/"${body.length.toString(16)}-${hash}"`;
}

/**
 * Decodes a response body according to its content type.
 * Server JSON must be exactly its 2-space indented form, then is parsed, so layout, key order and item order all stay
 * pinned; a package .json file is recorded as text.
 *
 * @param response - Response from request(), its status, Content-Type and X-Content-Type-Options deciding the decoding
 * @returns The JSON of a server response in its own order, the entries of an archive, the text of a UTF-8 or SVG
 * file, or the length and SHA-256 of any other file
 */
function readBody(response) {
    const { headers, body } = response;
    const type = headers['content-type'] ?? '';

    if (body.length === 0) return '';
    if (type === 'application/gzip') return readArchive(body);
    if (isServerJson(response)) {
        const text = body.toString('utf-8');
        assert.equal(text, JSON.stringify(JSON.parse(text), null, 2), 'server JSON is indented with 2 spaces');

        return JSON.parse(text);
    }
    if (type.includes('charset=utf-8') || type === 'image/svg+xml') return body.toString('utf-8');

    return { length: body.length, sha256: sha256(body) };
}

/**
 * Turns a response into its snapshot.
 * A weak ETag is recorded without its value: Express derives it from the JSON body, recorded in full, and
 * express.static from the date of the file in the clone. The ETag of server JSON is checked against its body first.
 *
 * @param response - Response from request()
 * @param options - cors also records the Access-Control-* headers, which every response carries; checkout hides the
 * Last-Modified of a repository file (favicon, robots.txt), which follows the date of the clone
 * @returns Status, recorded headers, and the decoded body, or aborted when the server cut the body short
 */
function capture(response, { cors = false, checkout = false } = {}) {
    if (!response.aborted && response.body.length > 0 && isServerJson(response)) {
        assert.equal(response.headers.etag, weakEtag(response.body), 'server JSON has the weak ETag of its body');
    }

    const names = Object.keys(response.headers).filter(
        (name) => HEADERS.includes(name) || (cors && name.startsWith('access-control-')),
    );
    const headers = Object.fromEntries(names.sort().map((name) => [name, response.headers[name]]));
    if (headers.etag?.startsWith('W/')) headers.etag = 'W/<weak>';
    if (checkout && headers['last-modified']) headers['last-modified'] = '<checkout>';

    if (response.aborted) return { status: response.status, headers, aborted: true };

    return { status: response.status, headers, body: readBody(response) };
}

/**
 * Names a test after its request, so each snapshot key reads like the request it records.
 *
 * @param request - Case from CASES, its method defaulting to GET
 * @returns The method and path, followed by the request headers in parentheses when the case sends any
 */
function caseName({ path, method = 'GET', headers = {} }) {
    const sent = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);

    return `${method} ${path}${sent.length > 0 ? ` (${sent.join(', ')})` : ''}`;
}

/**
 * Skips a test whose files a mode of 000 does not lock, as for root, except on CI where every locked case must run.
 * A skipped test also loses its snapshot entries on test:update, so CI fails instead of passing without them.
 *
 * @param t - Context of the test, failed rather than skipped when the CI variable is set to any non-empty value
 * @param reason - What stayed readable, given as the skip reason or in the failure message
 */
function skipLocked(t, reason) {
    assert.ok(!process.env.CI, `${reason}, so CI cannot check the locked cases`);

    t.skip(reason);
}

describe('routes', () => {
    let fixture;
    let server;

    before(async () => {
        fixture = createFixture();
        server = await startServer(fixture.packagesDir);
    });

    after(() => {
        server?.stop();
        fixture?.remove();
    });

    for (const entry of CASES) {
        test(caseName(entry), async (t) => {
            const { path, method = 'GET', headers, locked, checkout } = entry;
            if (locked && !fixture.locked) return skipLocked(t, 'the locked file stays readable, as it does for root');

            const response = await request(server.port, method, path, headers);
            t.assert.snapshot(capture(response, { cors: !!headers?.origin, checkout }));
        });
    }

    test('GET /health', async (t) => {
        const response = capture(await request(server.port, 'GET', '/health'));
        const { body } = response;

        assert.equal(body.version, pkg.version);
        assert.match(body.uptime, /^\d+h \d+m \d+s$/);
        for (const value of Object.values(body.memory)) assert.match(value, /^\d+\.\d{2} MB$/);

        t.assert.snapshot({
            ...response,
            headers: { ...response.headers, 'content-length': '<length>' },
            body: { ...body, version: '<version>', uptime: '<uptime>', memory: '<memory>' },
        });
    });

    test('GET /manifest', async (t) => {
        const response = capture(await request(server.port, 'GET', '/manifest'));

        assert.equal(response.body.version, pkg.version);

        t.assert.snapshot({
            ...response,
            headers: { ...response.headers, 'content-length': '<length>' },
            body: { ...response.body, version: '<version>' },
        });
    });

    test('GET /npm/lib@1.2.0/index.js (if-none-match: its etag)', async (t) => {
        const { headers } = await request(server.port, 'GET', '/npm/lib@1.2.0/index.js');

        t.assert.snapshot(
            capture(await request(server.port, 'GET', '/npm/lib@1.2.0/index.js', { 'if-none-match': headers.etag })),
        );
    });

    test('GET /npm/sealed@1.0.0 (version folder made unreadable after startup)', async (t) => {
        const folder = join(fixture.packagesDir, 'npm', 'sealed', '1.0.0');
        const { mode } = fs.statSync(folder);

        fs.chmodSync(folder, 0o000);
        try {
            if (isReadable(folder)) return skipLocked(t, 'the folder stays readable, as it does for root');

            // Snapshot keys hold no path, so entries 1, 2 and 3 follow the order of this list
            for (const path of ['/npm/sealed@1.0.0', '/npm/sealed@1.0.0?download', '/npm/sealed@1.0.0/index.js']) {
                const response = await request(server.port, 'GET', path);
                assert.ok(!response.body.toString('utf-8').includes(fixture.root), 'the error names a server path');

                t.assert.snapshot(capture(response));
            }
        } finally {
            fs.chmodSync(folder, mode);
        }
    });

    test('GET /npm/links@1.0.0/dist/loop/... (index.js after 40 and 41 link crossings, dist after 41)', async (t) => {
        const loop = 'dist/loop/';

        for (const path of [`${loop.repeat(40)}index.js`, `${loop.repeat(41)}index.js`, `${loop.repeat(41)}dist`]) {
            t.assert.snapshot(capture(await request(server.port, 'GET', `/npm/links@1.0.0/${path}`)));
        }
    });

    test('GET /health (101st request of a client within 10 seconds)', async (t) => {
        const headers = { 'cf-connecting-ip': '192.0.2.1' };

        for (let i = 0; i < 100; i++) assert.equal((await request(server.port, 'GET', '/health', headers)).status, 200);

        t.assert.snapshot(capture(await request(server.port, 'GET', '/health', headers)));
    });

    test('GET /, /health and /npm (server started without a packages folder)', async () => {
        const empty = await startServer(join(fixture.root, 'missing'));

        try {
            const root = await request(empty.port, 'GET', '/');
            assert.equal(root.status, 200);
            assert.deepEqual(JSON.parse(root.body).packages, {});

            const health = await request(empty.port, 'GET', '/health');
            assert.equal(health.status, 200);
            assert.equal(JSON.parse(health.body).packages, 0);

            const type = await request(empty.port, 'GET', '/npm');
            assert.equal(type.status, 404);
            assert.equal(JSON.parse(type.body).message, "Package type 'npm' does not exist.");
        } finally {
            empty.stop();
        }
    });
});
