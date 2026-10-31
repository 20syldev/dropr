import assert from 'assert/strict';
import fs from 'fs';
import { after, before, describe, test } from 'node:test';
import { join } from 'path';

import { capture, caseName, CASES } from './cases.mjs';
import { createFixture, isReadable } from './fixture.mjs';
import { config, request, rootDir, startServer } from './server.mjs';

const pkg = JSON.parse(fs.readFileSync(join(rootDir, 'package.json'), 'utf-8'));

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

    after(async () => {
        await server?.stop();
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
        const headers = { [config.clientIp.header]: '192.0.2.1' };

        for (let i = 0; i < 100; i++) assert.equal((await request(server.port, 'GET', '/health', headers)).status, 200);

        t.assert.snapshot(capture(await request(server.port, 'GET', '/health', headers)));
    });

    test('GET /, /health and /npm (server started without a packages folder)', async () => {
        const empty = await startServer(join(fixture.root, 'missing'));

        try {
            assert.match(empty.logs.errors[0][0], /^No packages folder at /);

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
            await empty.stop();
        }
    });
});
