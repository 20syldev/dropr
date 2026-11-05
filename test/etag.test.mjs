import assert from 'assert/strict';
import fs from 'fs';
import { after, before, describe, test } from 'node:test';
import { join } from 'path';

import { createFixture } from './fixture.mjs';
import { request, sha256, startServer } from './server.mjs';

describe('ETag of a file', () => {
    let fixture;
    let server;

    /**
     * Fetches the ETag header of a file of the fixture.
     *
     * @param path - Request target of the file, which must answer 200
     * @returns The header as sent, quotes included
     */
    async function etagOf(path) {
        const response = await request(server.port, 'GET', path);

        assert.equal(response.status, 200, path);

        return response.headers.etag;
    }

    before(async () => {
        fixture = createFixture();
        server = await startServer(fixture.packagesDir);
    });

    after(async () => {
        await server?.stop();
        fixture?.remove();
    });

    test('is the quoted SHA-256 of the bytes on disk', async () => {
        const path = 'packages/npm/lib/1.2.0/dist/nested/deep.cjs';
        const etag = await etagOf('/npm/lib@1.2.0/dist/nested/deep.cjs');

        assert.equal(etag, `"${sha256(fs.readFileSync(join(fixture.root, path)))}"`);
        assert.match(etag, /^"[0-9a-f]{64}"$/);
    });

    test('equals the checksum of ?checksums for every file of a version', async () => {
        for (const path of ['/npm/lib@1.2.0', '/npm/lib@1.0.0', '/npm/links@1.0.0', '/bash/gft@1.2.0']) {
            const sums = JSON.parse((await request(server.port, 'GET', `${path}?checksums`)).body).checksums;
            const files = Object.entries(sums);

            assert.ok(files.length > 0, path);
            for (const [file, sum] of files)
                assert.equal(await etagOf(`${path}/${file}`), `"${sum}"`, `${path}/${file}`);
        }
    });

    test('follows the bytes, not the date or the version', async () => {
        const first = await etagOf('/npm/lib@1.2.0/index.js');

        assert.equal(await etagOf('/npm/lib@1.2.0/dist/index.mjs'), first, 'same bytes under another name');
        assert.equal(await etagOf('/npm/lib@1.2/index.js'), first, 'same file reached through a partial version');
        assert.notEqual(await etagOf('/npm/lib@1.0.0/index.js'), first, 'other bytes');
    });

    test('is the one of its target for a link that stays inside the version', async () => {
        assert.equal(await etagOf('/npm/links@1.0.0/inside'), await etagOf('/npm/links@1.0.0/index.js'));
        assert.equal(await etagOf('/npm/links@1.0.0/folder/file.js'), await etagOf('/npm/links@1.0.0/dist/file.js'));
    });

    test('is the same on HEAD, while a listing has no tag', async () => {
        const path = '/npm/lib@1.2.0/index.js';
        const head = await request(server.port, 'HEAD', path);

        assert.equal(head.status, 200);
        assert.equal(head.headers.etag, await etagOf(path));
        assert.equal((await request(server.port, 'GET', '/npm/lib@1.2.0/dist')).headers.etag, undefined);
    });

    test('answers 304 to its own tag, a list or a weak copy, and 200 to another tag', async () => {
        const path = '/npm/lib@1.2.0/index.js';
        const etag = await etagOf(path);
        const status = async (value) => (await request(server.port, 'GET', path, { 'if-none-match': value })).status;

        assert.equal(await status(etag), 304);
        assert.equal(await status(`"other", ${etag}`), 304);
        assert.equal(await status(`W/${etag}`), 304);
        assert.equal(await status('*'), 304);
        assert.equal(await status('"other"'), 200);
    });

    test('keeps the 304 headers of the file, and sends no body with it', async () => {
        const path = '/npm/lib@1.2.0/index.js';
        const etag = await etagOf(path);
        const response = await request(server.port, 'GET', path, { 'if-none-match': etag });

        assert.equal(response.status, 304);
        assert.equal(response.headers.etag, etag);
        assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
        assert.equal(response.body.length, 0);
    });

    test('works as the validator of If-Match and If-Range', async () => {
        const path = '/npm/lib@1.2.0/index.js';
        const etag = await etagOf(path);
        const send = (headers) => request(server.port, 'GET', path, headers);

        assert.equal((await send({ 'if-match': etag })).status, 200);
        assert.equal((await send({ 'if-match': '"other"' })).status, 412);

        const partial = await send({ range: 'bytes=0-5', 'if-range': etag });
        assert.equal(partial.status, 206);
        assert.equal(partial.body.toString(), 'export');
        assert.equal((await send({ range: 'bytes=0-5', 'if-range': '"other"' })).status, 200);
    });
});

describe('Last-Modified of a file', () => {
    const path = '/npm/lib@1.2.0/index.js';
    const released = 'Thu, 01 May 2025 00:00:00 GMT';
    let fixture;
    let server;

    before(async () => {
        fixture = createFixture();
        server = await startServer(fixture.packagesDir);
    });

    after(async () => {
        await server?.stop();
        fixture?.remove();
    });

    test('is the release day of the version at 00:00:00 GMT, whatever the date of the file', async () => {
        const send = (method, headers) => request(server.port, method, path, headers);

        assert.equal((await send('GET')).headers['last-modified'], released);
        assert.equal((await send('HEAD')).headers['last-modified'], released);
        assert.equal((await send('GET', { range: 'bytes=0-5' })).headers['last-modified'], released);
        assert.equal(
            (await send('GET', { 'if-none-match': (await send('GET')).headers.etag })).headers['last-modified'],
            released,
        );
    });

    test('is the validator of If-Modified-Since and If-Unmodified-Since', async () => {
        const send = (headers) => request(server.port, 'GET', path, headers);

        assert.equal((await send({ 'if-modified-since': released })).status, 304);
        assert.equal((await send({ 'if-modified-since': 'Wed, 30 Apr 2025 23:59:59 GMT' })).status, 200);
        assert.equal((await send({ 'if-unmodified-since': released })).status, 200);
        assert.equal((await send({ 'if-unmodified-since': 'Wed, 30 Apr 2025 23:59:59 GMT' })).status, 412);
    });
});
