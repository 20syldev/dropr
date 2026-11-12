import assert from 'assert/strict';
import fs from 'fs';
import http from 'http';
import { after, before, describe, test } from 'node:test';
import { join } from 'path';

import { createReader } from '../dist/disk.js';
import type { ByteRange, ReadFile } from '../dist/types/index.js';

import { createFixture } from './fixture.ts';
import type { Fixture } from './fixture.ts';
import { model } from './model.ts';
import { eventually, memoryPort } from './port.ts';
import { config, request, startServer } from './server.ts';
import type { Reply, TestServer } from './server.ts';

const FILE = '/npm/lib@1.2.0/index.js';
const CONTENT = 'export default "1.2.0";\n';
const LAST_MODIFIED = Date.UTC(2025, 4, 1);

/**
 * Lists the response headers of the core, leaving out the ones Node and CORS add to every answer.
 *
 * @param response - Response from request()
 * @returns The header names in alphabetical order, without date, connection, keep-alive and access-control-*
 */
function names({ headers }: Pick<Reply, 'headers'>): string[] {
    return Object.keys(headers)
        .filter((name) => !['date', 'connection', 'keep-alive'].includes(name))
        .filter((name) => !name.startsWith('access-control-'))
        .sort();
}

/**
 * Copies an object without some of its keys.
 *
 * @param object - Headers or any plain object
 * @param keys - Names to leave out
 * @returns A new object
 */
function without<T extends object>(object: T, ...keys: string[]): T {
    return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key))) as T;
}

/**
 * Sends a request and tells whether the server cut the response, before or after its headers.
 *
 * @param port - Port of the server
 * @param path - Request target
 * @returns The response, with aborted true when the connection was reset after the headers, or { reset: true } when it
 * was reset before any header
 */
async function outcome(port: number, path: string): Promise<Reply | { reset: boolean; aborted: boolean }> {
    try {
        return await request(port, 'GET', path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') return { reset: true, aborted: true };

        throw error;
    }
}

/**
 * Reads the first argument of the last error the app logged.
 *
 * @param server - Server started by startServer
 * @returns The arguments of the last logged error
 */
function lastError(server: TestServer): string[] {
    return server.logs.errors.at(-1) as string[];
}

describe('files over HTTP', () => {
    let fixture: Fixture;
    let server: TestServer;
    let etag: string;

    before(async () => {
        fixture = createFixture();
        server = await startServer(fixture.packagesDir);
        etag = (await request(server.port, 'GET', FILE)).headers.etag as string;
    });

    after(async () => {
        await server?.stop();
        fixture?.remove();
    });

    const send = (headers: Record<string, string>, method = 'GET', path = FILE) =>
        request(server.port, method, path, headers);

    test('a range is a 206 with the bytes, their length and the validators of the file', async () => {
        const response = await send({ range: 'bytes=0-5' });

        assert.equal(response.status, 206);
        assert.equal(response.body.toString(), 'export');
        assert.deepEqual(names(response), [
            'accept-ranges',
            'cache-control',
            'content-length',
            'content-range',
            'content-type',
            'etag',
            'last-modified',
            'x-content-type-options',
        ]);
        assert.equal(response.headers['content-range'], 'bytes 0-5/24');
        assert.equal(response.headers['content-length'], '6');
        assert.equal(response.headers.etag, etag);
    });

    test('every range of a small file gives what the model of RFC 9110 names, bytes included', async () => {
        const values = [];
        for (let first = 0; first <= 25; first++) {
            values.push(`bytes=${first}-`, `bytes=-${first}`);
            for (let last = first; last <= 26; last++) values.push(`bytes=${first}-${last}`);
        }

        for (const value of values) {
            const named = model({ method: 'GET', size: 24, etag, lm: LAST_MODIFIED, h: { range: value } });
            const response = await send({ range: value });

            assert.equal(response.status, named.status, value);
            if (named.status === 416) {
                assert.equal(response.headers['content-range'], 'bytes */24', value);
                continue;
            }

            const [first, last] = named.range as [number, number];
            assert.equal(response.body.toString(), CONTENT.slice(first, last + 1), value);
            assert.equal(
                response.headers['content-range'],
                named.status === 206 ? `bytes ${first}-${last}/24` : undefined,
                value,
            );
        }
    });

    test('ranges that are cut, open, a suffix, merged or spelled in upper case give the bytes asked', async () => {
        for (const [value, first, last] of [
            ['bytes=-4', 20, 23],
            ['bytes=-100', 0, 23],
            ['bytes=20-', 20, 23],
            ['bytes=0-999', 0, 23],
            ['bytes=23-23', 23, 23],
            ['bytes=0-5,3-8', 0, 8],
            ['BYTES=1-2', 1, 2],
        ] as const) {
            const response = await send({ range: value });

            assert.equal(response.status, 206, value);
            assert.equal(response.body.toString(), CONTENT.slice(first, last + 1), value);
            assert.equal(response.headers['content-range'], `bytes ${first}-${last}/24`, value);
        }
    });

    test('a set of ranges that stays split, an unreadable Range or another unit gives the whole file', async () => {
        for (const value of ['bytes=0-1,5-6', 'bytes=a-b', 'bytes=5-2', 'items=0-5', 'bytes=']) {
            const response = await send({ range: value });

            assert.equal(response.status, 200, value);
            assert.equal(response.body.toString(), CONTENT, value);
            assert.equal(response.headers['content-range'], undefined, value);
        }
    });

    test('an unsatisfiable range is a 416 that names the size, in the one error body', async () => {
        for (const value of ['bytes=24-', 'bytes=99-120', 'bytes=-0']) {
            const response = await send({ range: value });

            assert.equal(response.status, 416, value);
            assert.equal(response.headers['content-range'], 'bytes */24');
            assert.deepEqual(names(response), ['content-length', 'content-range', 'content-type']);
            assert.deepEqual(JSON.parse(response.body.toString()), {
                status: 416,
                error: 'Range Not Satisfiable',
                message: "Range not satisfiable for file 'index.js'.",
            });
            assert.equal(response.headers['content-length'], String(response.body.length));
        }
    });

    test('If-Range with the tag or the date keeps the range, anything else gives the whole file', async () => {
        const date = 'Thu, 01 May 2025 00:00:00 GMT';

        assert.equal((await send({ range: 'bytes=0-5', 'if-range': etag })).status, 206);
        assert.equal((await send({ range: 'bytes=0-5', 'if-range': date })).status, 206);
        assert.equal((await send({ range: 'bytes=0-5', 'if-range': `W/${etag}` })).status, 200);
        assert.equal((await send({ range: 'bytes=0-5', 'if-range': 'Fri, 02 May 2025 00:00:00 GMT' })).status, 200);
        assert.equal((await send({ range: 'bytes=99-', 'if-range': '"other"' })).status, 200);
    });

    test('every 304 has one shape: the validators and the cache lifetime, no body, no type, no length', async () => {
        const date = 'Thu, 01 May 2025 00:00:00 GMT';
        const asks: Record<string, string>[] = [
            { 'if-none-match': etag },
            { 'if-none-match': `W/${etag}` },
            { 'if-none-match': `"other", ${etag}` },
            { 'if-none-match': '*' },
            { 'if-modified-since': date },
            { 'if-modified-since': 'Fri, 02 May 2025 00:00:00 GMT' },
            { 'if-none-match': etag, range: 'bytes=0-5' },
        ];

        for (const headers of asks) {
            const response = await send(headers);

            assert.equal(response.status, 304, JSON.stringify(headers));
            assert.deepEqual(names(response), ['cache-control', 'etag', 'last-modified']);
            assert.equal(response.headers.etag, etag);
            assert.equal(response.body.length, 0);
        }
    });

    test('If-Match is read first: a wrong tag is a 412 even with a matching If-None-Match', async () => {
        const response = await send({ 'if-match': '"other"', 'if-none-match': etag });

        assert.equal(response.status, 412);
        assert.deepEqual(names(response), ['content-length', 'content-type']);
        assert.equal(JSON.parse(response.body.toString()).message, "Precondition failed for file 'index.js'.");
        assert.equal((await send({ 'if-match': `W/${etag}` })).status, 412);
        assert.equal((await send({ 'if-match': etag })).status, 200);
        assert.equal((await send({ 'if-unmodified-since': 'Wed, 30 Apr 2025 23:59:59 GMT' })).status, 412);
    });

    test('a request Cache-Control does not change a conditional answer', async () => {
        assert.equal((await send({ 'if-none-match': etag, 'cache-control': 'no-cache' })).status, 304);
    });

    test('HEAD is the GET without its body: same status, same headers, and the length of the body', async () => {
        const asks: [string, Record<string, string>][] = [
            [FILE, {}],
            [FILE, { range: 'bytes=0-5' }],
            [FILE, { range: 'bytes=99-' }],
            [FILE, { 'if-none-match': etag }],
            [FILE, { 'if-match': '"x"' }],
            ['/npm/lib@1.2.0/missing.js', {}],
            ['/npm/lib@1.2.0/dist', {}],
            ['/npm/lib', {}],
            ['/', {}],
            ['/search?q=lib', {}],
            ['/npm/lib@1.2.0?checksums', {}],
            ['/npm/lib@1.2.0?download', {}],
            ['/nope', {}],
        ];

        for (const [path, headers] of asks) {
            const head = await send(headers, 'HEAD', path);
            const expectation = await send(without(headers, 'range', 'if-range'), 'GET', path);

            assert.equal(head.status, expectation.status, path);
            assert.equal(head.body.length, 0, path);
            const volatile = ['transfer-encoding', 'date'];
            assert.deepEqual(
                without(head.headers, ...volatile),
                without(expectation.headers, ...volatile),
                `${path} ${JSON.stringify(headers)}`,
            );
        }
    });

    test('a JSON answer has a length and no validator, and ignores every conditional header', async () => {
        for (const path of [
            '/',
            '/npm/lib',
            '/npm/lib@1.2.0',
            '/npm/lib@1.2.0/dist',
            '/search?q=lib',
            '/nope',
            '/health',
            '/manifest',
        ]) {
            const response = await send({}, 'GET', path);

            assert.equal(response.headers.etag, undefined, path);
            assert.equal(response.headers['last-modified'], undefined, path);
            assert.equal(response.headers['content-length'], String(response.body.length), path);
        }

        const listing = '/npm/lib@1.2.0/dist';
        const plain = await send({}, 'GET', listing);
        for (const headers of [
            { 'if-none-match': '*' },
            { 'if-match': '"x"' },
            { 'if-modified-since': 'Thu, 01 May 2025 00:00:00 GMT' },
            { range: 'bytes=0-5' },
        ] as Record<string, string>[]) {
            const response = await send(headers, 'GET', listing);

            assert.deepEqual([response.status, response.body], [200, plain.body], JSON.stringify(headers));
        }
    });

    test('a range of a version that moves is cached for 5 minutes, one of an exact version for a year', async () => {
        assert.equal(
            (await send({ range: 'bytes=0-1' }, 'GET', '/npm/lib@1/index.js')).headers['cache-control'],
            'public, max-age=300',
        );
        assert.match((await send({ range: 'bytes=0-1' })).headers['cache-control'] as string, /immutable/);
    });
});

describe('a file that is not what the index says', () => {
    let fixture: Fixture;
    let server: TestServer;
    const target = (fixture: Fixture) => join(fixture.packagesDir, 'npm', 'lib', '1.0.0', 'package.json');
    const original = '{ "name": "lib", "version": "1.0.0" }\n';

    before(async () => {
        fixture = createFixture();
        server = await startServer(fixture.packagesDir);
    });

    after(async () => {
        await server?.stop();
        fixture?.remove();
    });

    test('a file removed after startup is the 404 of a missing file, without a header of the file, and is logged', async () => {
        fs.unlinkSync(target(fixture));
        try {
            const response = await request(server.port, 'GET', '/npm/lib@1.0.0/package.json', { range: 'bytes=0-5' });

            assert.equal(response.status, 404);
            assert.equal(
                JSON.parse(response.body.toString()).message,
                "File 'package.json' does not exist in the 1.0.0 version of the 'lib' project.",
            );
            assert.deepEqual(names(response), ['content-length', 'content-type']);
            assert.match(lastError(server)[0], /^File error on npm\/lib\/1\.0\.0\/package\.json:/);

            // HEAD trusts the index and opens nothing
            assert.equal((await request(server.port, 'HEAD', '/npm/lib@1.0.0/package.json')).status, 200);
        } finally {
            fs.writeFileSync(target(fixture), original);
        }
    });

    test('a file replaced by a folder after startup is the 404 of a missing file, with or without a range', async () => {
        fs.unlinkSync(target(fixture));
        fs.mkdirSync(target(fixture));
        try {
            for (const headers of [{}, { range: 'bytes=0-5' }] as Record<string, string>[]) {
                const response = await request(server.port, 'GET', '/npm/lib@1.0.0/package.json', headers);

                assert.equal(response.status, 404, JSON.stringify(headers));
                assert.match(lastError(server)[0], /^File error on npm\/lib\/1\.0\.0\/package\.json:/);
            }
        } finally {
            fs.rmdirSync(target(fixture));
            fs.writeFileSync(target(fixture), original);
        }
    });

    test('a file removed from a deprecated project keeps the Deprecation and Link headers of the project', async () => {
        const old = join(fixture.packagesDir, 'npm', 'old', '1.0.0', 'index.js');
        const present = await request(server.port, 'GET', '/npm/old@1.0.0/index.js');
        fs.unlinkSync(old);
        try {
            const response = await request(server.port, 'GET', '/npm/old@1.0.0/index.js');

            assert.equal(response.status, 404);
            assert.ok(present.headers.deprecation);
            assert.deepEqual(names(response), ['content-length', 'content-type', 'deprecation', 'link']);
            assert.equal(response.headers.deprecation, present.headers.deprecation);
            assert.equal(response.headers.link, present.headers.link);
        } finally {
            fs.writeFileSync(old, 'export default "old";\n');
        }
    });

    test('a file cut after startup is a 404 when the range ends past its end, and still served below it', async () => {
        fs.truncateSync(target(fixture), 10);
        try {
            const whole = await request(server.port, 'GET', '/npm/lib@1.0.0/package.json');
            const part = await request(server.port, 'GET', '/npm/lib@1.0.0/package.json', { range: 'bytes=0-4' });

            assert.equal(whole.status, 404);
            assert.deepEqual([part.status, part.body.toString()], [206, '{ "na']);
        } finally {
            fs.writeFileSync(target(fixture), original);
        }
    });

    test('an archive of a version with a file cut after startup is cut off, not ended', async () => {
        fs.truncateSync(target(fixture), 10);
        try {
            const response = await request(server.port, 'GET', '/npm/lib@1.0.0?download');

            assert.equal(response.aborted, true);
            assert.match(lastError(server)[0], /^Archive error on npm\/lib\/1\.0\.0:/);
        } finally {
            fs.writeFileSync(target(fixture), original);
        }
    });
});

describe('a file that was empty at startup', () => {
    let fixture: Fixture;
    let server: TestServer;
    let empty: string;

    before(async () => {
        fixture = createFixture();
        empty = join(fixture.packagesDir, 'npm', 'lib', '1.0.0', 'empty.txt');
        fs.writeFileSync(empty, '');
        server = await startServer(fixture.packagesDir);
    });

    after(async () => {
        await server?.stop();
        fs.unlinkSync(empty);
        fixture?.remove();
    });

    test('is answered empty even when it holds bytes by now', async () => {
        const path = '/npm/lib@1.0.0/empty.txt';
        const startup = await request(server.port, 'GET', path);
        fs.writeFileSync(empty, 'now it holds bytes\n');
        const grown = await request(server.port, 'GET', path);

        assert.deepEqual([startup.status, startup.body.length], [200, 0]);
        assert.deepEqual([grown.status, grown.body.length, grown.aborted], [200, 0, false]);
        assert.equal(grown.headers['content-length'], '0');
    });

    test('is the 404 of a missing file when it is removed', async () => {
        fs.unlinkSync(empty);
        try {
            assert.equal((await request(server.port, 'GET', '/npm/lib@1.0.0/empty.txt')).status, 404);
        } finally {
            fs.writeFileSync(empty, '');
        }
    });
});

describe('the read port of a file response', () => {
    let fixture: Fixture;
    const servers: TestServer[] = [];

    before(() => {
        fixture = createFixture();
    });

    after(async () => {
        await Promise.all(servers.map((server) => server.stop()));
        fixture?.remove();
    });

    const serve = async (read: ReadFile) => {
        const server = await startServer(fixture.packagesDir, {}, { read });
        servers.push(server);

        return server;
    };

    test('is asked for the range and the path, once, and never for HEAD, 304, 412 or 416', async () => {
        const asked: [string, ByteRange | undefined][] = [];
        const port = memoryPort(() => Buffer.from(CONTENT));
        const read = async (path: string, range?: ByteRange) => (asked.push([path, range]), port(path, range));
        const server = await serve(read);
        const get = (headers: Record<string, string>, method = 'GET') => request(server.port, method, FILE, headers);
        const tag = (await get({})).headers.etag as string;
        asked.length = 0;

        await get({ range: 'bytes=2-4' });
        await get({});
        await get({}, 'HEAD');
        await get({ range: 'bytes=0-5' }, 'HEAD');
        await get({ 'if-none-match': tag });
        await get({ 'if-match': '"x"' });
        await get({ range: 'bytes=99-' });

        assert.deepEqual(asked, [
            ['npm/lib/1.2.0/index.js', { start: 2, end: 4 }],
            ['npm/lib/1.2.0/index.js', { start: 0, end: 23 }],
        ]);
    });

    test('that fails to open gives the 404 of a missing file, whatever the error', async () => {
        for (const error of [
            Object.assign(new Error('x'), { code: 'EACCES' }),
            new Error('anything'),
            new RangeError('short'),
        ]) {
            const server = await serve(() => Promise.reject(error));
            const response = await request(server.port, 'GET', FILE);

            assert.equal(response.status, 404);
            assert.deepEqual(names(response), ['content-length', 'content-type']);
        }
    });

    test('that fails midway cuts the connection after the headers, and is logged', async () => {
        let sent = false;
        const read = async () =>
            new ReadableStream({
                pull(controller) {
                    if (sent) throw new Error('EIO: read failed');

                    sent = true;
                    controller.enqueue(new TextEncoder().encode('expo'));
                },
            });
        const server = await serve(read);
        const response = await request(server.port, 'GET', FILE);

        assert.equal(response.status, 200);
        assert.equal(response.headers['content-length'], '24');
        assert.equal(response.aborted, true);
        assert.ok(response.body.length <= 4);
        assert.match(lastError(server)[0], /^File error on npm\/lib\/1\.2\.0\/index\.js:/);
        assert.match(lastError(server)[1], /EIO/);
    });

    test('that runs short or long cuts the connection, so the body never differs from its length', async () => {
        for (const [bytes, text] of [
            ['export default "1.2.0"', /before the expected 24/],
            ['export default "1.2.0";\n+', /more than the expected 24/],
        ] as const) {
            const server = await serve(async () => new Blob([bytes]).stream());
            const response = await outcome(server.port, FILE);

            assert.equal(response.aborted, true, bytes);
            assert.match(lastError(server)[1], text);
        }
    });

    test('is cancelled when the client goes away', async () => {
        const log = { cancelled: false };
        // One chunk, then a stall: the file never ends or runs long, so only the cancel can end the stream
        let sent = false;
        const read = async () =>
            new ReadableStream({
                pull: (controller) => {
                    if (sent) return new Promise(() => undefined);

                    sent = true;
                    controller.enqueue(new Uint8Array(4));
                },
                cancel: () => void (log.cancelled = true),
            });
        const server = await serve(read);
        const scanned = server.logs.errors.length;

        await new Promise<void>((resolve) => {
            const req = http.request(
                {
                    host: '127.0.0.1',
                    port: server.port,
                    path: FILE,
                    headers: { [config.clientIp.header as string]: '10.9.9.9' },
                },
                (res) => {
                    res.once('data', () => (req.destroy(), resolve()));
                },
            );
            req.on('error', () => undefined);
            req.end();
        });

        assert.ok(await eventually(() => log.cancelled), 'the stream of the port was not cancelled');

        // A client that leaves is not a failure of the file, whatever was still being read
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.deepEqual(server.logs.errors.slice(scanned), []);
    });

    const leaveWhileOpening = async (cancel: () => void | PromiseLike<void>) => {
        const log = { asked: false, cancelled: false };
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const read = async () => {
            log.asked = true;
            await gate;

            return new ReadableStream({
                cancel: () => {
                    log.cancelled = true;

                    return cancel();
                },
            });
        };
        const server = await serve(read);
        const req = http.request({
            host: '127.0.0.1',
            port: server.port,
            path: FILE,
            headers: { [config.clientIp.header as string]: '10.9.9.8' },
        });
        req.on('error', () => undefined);
        req.end();
        assert.ok(await eventually(() => log.asked), 'the port was not asked for the file');
        req.destroy();
        // The close of the client must reach the server before the file opens, or the two orders would not be told apart
        await new Promise((resolve) => setTimeout(resolve, 50));
        release();

        assert.ok(await eventually(() => log.cancelled), 'the stream of the port was not cancelled');

        return server;
    };

    test('is cancelled when the client leaves while the file opens', async () => {
        await leaveWhileOpening(() => undefined);
    });

    test('whose cancel fails does not stop the server when the client leaves while the file opens', async () => {
        const server = await leaveWhileOpening(() => Promise.reject(new Error('cancel failed')));
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.equal((await request(server.port, 'GET', '/health')).status, 200);
    });

    test('lets an archive send its headers before the first file is read', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const disk = createReader(fixture.packagesDir);
        const server = await serve(async (path: string, range?: ByteRange) => (await gate, disk(path, range)));
        let timer: NodeJS.Timeout | undefined;
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('no header before the first file is read')), 3000);
            const req = http.get(
                {
                    host: '127.0.0.1',
                    port: server.port,
                    path: '/npm/lib@1.0.0?download',
                    headers: { [config.clientIp.header as string]: '10.9.9.7' },
                },
                resolve,
            );
            req.on('error', reject);
        }).finally(() => clearTimeout(timer));
        release();
        await new Promise((resolve) => (response.resume(), response.on('close', resolve)));

        assert.equal(response.statusCode, 200);
        assert.equal(response.complete, true);
    });
});
