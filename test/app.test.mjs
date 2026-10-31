import assert from 'assert/strict';
import { spawn } from 'child_process';
import fs from 'fs';
import { after, before, describe, test } from 'node:test';
import { join } from 'path';

import { createApp } from '../dist/app.js';
import { parseConfig } from '../dist/lib/config.js';
import { ROUTES } from '../dist/manifest.js';

import { createFixture } from './fixture.mjs';
import { config, freePort, listen, request, rootDir, startServer } from './server.mjs';

const EMPTY = { format: 1, types: [] };

/**
 * Starts an app from a minimal config, with a logger that records what it is given.
 *
 * @param change - Config keys spread over the minimal config, so a manifest or clientIp given replaces the minimal one
 * @param packagesDir - Folder the package files are read from
 * @returns The port, stop() and the recorded logs
 */
async function start(change = {}, packagesDir = rootDir) {
    const logs = { requests: [], errors: [] };
    const logger = { request: (entry) => logs.requests.push(entry), error: (...args) => logs.errors.push(args) };
    const parsed = parseConfig({ manifest: { baseUrl: 'https://cdn.example.com' }, ...change });
    const app = createApp(parsed, { index: EMPTY, packagesDir, version: '9.9.9', logger });

    return { ...(await listen(app)), logs };
}

/**
 * Sends the same request many times.
 *
 * @param server - Server returned by start()
 * @param count - Number of requests
 * @param headers - Headers of every request, or a function of the request number
 * @returns The status of the last request
 */
async function repeat(server, count, headers) {
    let status;
    for (let i = 0; i < count; i++) {
        const extra = typeof headers === 'function' ? headers(i) : headers;
        ({ status } = await request(server.port, 'GET', '/health', extra));
    }

    return status;
}

describe('createApp', () => {
    let fixture;

    before(() => (fixture = createFixture()));
    after(() => fixture?.remove());

    test('a config with only a base URL serves the English manifest', async () => {
        const server = await start();
        try {
            const response = await request(server.port, 'GET', '/manifest');
            const manifest = JSON.parse(response.body);

            assert.equal(response.headers['cache-control'], 'public, max-age=300');
            assert.deepEqual(
                [manifest.name, manifest.version, manifest.baseUrl],
                ['dropr', '9.9.9', 'https://cdn.example.com'],
            );
            assert.deepEqual(
                manifest.routes.map((entry) => entry.id),
                ROUTES.map((spec) => spec.id),
            );
            const [file] = manifest.routes;
            assert.deepEqual(
                [file.title, file.path, file.example, file.params.map((param) => param.name)],
                [
                    'File',
                    '/{type}/{project}@{version}/{file}',
                    '/npm/moxon@6.1.0/package.json',
                    ['type', 'project', 'version', 'file'],
                ],
            );
            assert.match(file.summary, /^Serves a file of a version/);
        } finally {
            await server.stop();
        }
    });

    test('overrides of the config reach the manifest over the defaults, and the name reaches the health body', async () => {
        const manifest = {
            baseUrl: 'https://cdn.example.com',
            params: { project: { name: 'name', description: 'The project.', example: 'lib' } },
            routes: { project: { title: 'Library', notes: ['One note.'] } },
        };
        const server = await start({ name: 'other', manifest });
        try {
            const { routes } = JSON.parse((await request(server.port, 'GET', '/manifest')).body);
            const route = routes.find((r) => r.id === 'project');
            const download = routes.find((r) => r.id === 'download');
            const health = JSON.parse((await request(server.port, 'GET', '/health')).body);

            assert.deepEqual(
                [route.path, route.title, route.notes, route.example],
                ['/{type}/{name}', 'Library', ['One note.'], '/npm/moxon'],
            );
            assert.equal(route.summary, 'Lists the versions of a project, with latest.');
            assert.deepEqual(route.params[1], {
                name: 'name',
                in: 'path',
                required: true,
                description: 'The project.',
                example: 'lib',
            });
            assert.equal(download.path, '/download/{type}/{name}@{version}');
            assert.equal(download.notes[1], 'Same as `/{type}/{name}@{version}?download`.');
            assert.deepEqual([health.name, health.version, health.packages], ['other', '9.9.9', 0]);
        } finally {
            await server.stop();
        }
    });

    test('serves the configured assets only', async () => {
        const file = join(fixture.root, 'robots.txt');
        fs.writeFileSync(file, 'User-agent: *\n');
        const server = await start({ assets: { '/robots.txt': file } });
        try {
            const robots = await request(server.port, 'GET', '/robots.txt');
            const icon = await request(server.port, 'GET', '/favicon.ico');

            assert.deepEqual([robots.status, robots.body.toString()], [200, 'User-agent: *\n']);
            assert.equal(icon.status, 404);
        } finally {
            fs.unlinkSync(file);
            await server.stop();
        }
    });

    test('without a client IP header, every request counts for the socket address', async () => {
        const server = await start();
        try {
            assert.equal(
                await repeat(server, 101, (i) => ({ 'x-forwarded-for': `10.0.0.${i}`, 'x-real-ip': `10.1.0.${i}` })),
                429,
            );
        } finally {
            await server.stop();
        }
    });

    test('with a client IP header, each value has its own limit', async () => {
        const server = await start({ clientIp: { header: 'X-Test-Client' } });
        try {
            assert.equal(await repeat(server, 101, { 'x-test-client': 'a' }), 429);
            assert.equal(await repeat(server, 1, { 'x-test-client': 'b' }), 200);
        } finally {
            await server.stop();
        }
    });

    test('X-Forwarded-For counts only when the proxy is trusted', async () => {
        const forwarded = (i) => ({ 'x-forwarded-for': `10.0.0.${i}` });
        const trusted = await start({ clientIp: { trustProxy: true } });
        const plain = await start();
        try {
            assert.equal(await repeat(trusted, 101, forwarded), 200);
            assert.equal(await repeat(plain, 101, forwarded), 429);
        } finally {
            await trusted.stop();
            await plain.stop();
        }
    });

    test('two apps keep their own limiter, and the env is never read', async () => {
        const env = { PORT: process.env.PORT, PACKAGES_DIR: process.env.PACKAGES_DIR };
        process.env.PORT = 'junk';
        process.env.PACKAGES_DIR = join(fixture.root, 'missing');
        const first = await start();
        const second = await start();
        try {
            assert.equal(await repeat(first, 101), 429);
            assert.equal(await repeat(second, 1), 200);
        } finally {
            for (const [key, value] of Object.entries(env)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
            await first.stop();
            await second.stop();
        }
    });

    test('the logger gets every request, and the scan messages of startServer', async () => {
        const server = await startServer(join(fixture.root, 'missing'));
        try {
            await request(server.port, 'GET', '/npm');

            assert.match(server.logs.errors[0][0], /^No packages folder at /);
            assert.deepEqual(
                server.logs.requests.map(({ method, url, status }) => ({ method, url, status })),
                [{ method: 'GET', url: '/npm', status: 404 }],
            );
            assert.ok(Number.isInteger(server.logs.requests[0].duration));
        } finally {
            await server.stop();
        }
    });
});

describe('dist/serve.js', () => {
    let fixture;

    before(() => (fixture = createFixture()));
    after(() => fixture?.remove());

    /**
     * Runs the entry point in a child process until it exits or listens.
     *
     * @param args - Arguments of the entry point
     * @param env - Env added to the one of the test, which cannot leak PORT or PACKAGES_DIR in
     * @param probe - Called once the child reports it is running, which is killed after it settles
     * @returns Exit code, stdout, stderr and the value of probe; a child still listening is killed and reports a null
     * code, and one that neither exits nor listens within 10 seconds is killed and rejects with its stderr
     */
    function run(args = [], env = {}, probe = undefined) {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [join(rootDir, 'dist', 'serve.js'), ...args], {
                env: { ...process.env, PORT: '', PACKAGES_DIR: '', ...env },
            });
            let stdout = '';
            let stderr = '';
            let probed;
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`serve.js neither exited nor listened within 10 seconds: ${stderr}`));
            }, 10_000);
            child.stderr.on('data', (chunk) => (stderr += chunk));
            child.stdout.on('data', (chunk) => {
                stdout += chunk;
                if (probed || !stdout.includes('is running')) return;

                probed = Promise.resolve(probe?.())
                    .catch(reject)
                    .finally(() => child.kill());
            });
            child.on('close', async (code) => {
                clearTimeout(timer);
                resolve({ code, stdout, stderr, probed: await probed });
            });
        });
    }

    test('listens on PORT, serving PACKAGES_DIR, and prints that it is running', async () => {
        const port = await freePort();
        const env = { PORT: String(port), PACKAGES_DIR: join(fixture.root, 'packages') };
        const { stdout, probed } = await run([], env, async () => ({
            health: JSON.parse((await request(port, 'GET', '/health')).body),
            file: await request(port, 'GET', '/npm/lib@1.2.0/index.js'),
        }));

        const banner = `${config.name} is running on\n    - http://127.0.0.1:${port}\n    - http://localhost:${port}\n`;
        assert.ok(stdout.startsWith(banner), stdout);
        assert.ok(probed.health.packages > 0);
        assert.equal(probed.file.body.toString(), 'export default "1.2.0";\n');
    });

    test('reads the config file of its first argument, and resolves its paths against that folder', async () => {
        const port = await freePort();
        const file = join(fixture.root, 'other.json');
        const input = { name: 'other', manifest: { baseUrl: 'https://cdn.example.com' }, packagesDir: 'packages' };
        fs.writeFileSync(file, JSON.stringify(input));

        try {
            const { stdout, probed } = await run([file], { PORT: String(port) }, async () =>
                request(port, 'GET', '/npm/lib@1.2.0/index.js'),
            );

            assert.match(stdout, /^other is running on\n/);
            assert.equal(probed.body.toString(), 'export default "1.2.0";\n');
        } finally {
            fs.unlinkSync(file);
        }
    });

    test('exits with 1 and does not listen when the config is refused', async () => {
        const { code, stdout, stderr } = await run([join(rootDir, 'package.json')]);

        assert.equal(code, 1);
        assert.equal(stdout, '');
        assert.match(stderr, /^Invalid config: /);
    });

    test('importing dist/app.js reads nothing, prints nothing and leaves nothing listening', async () => {
        const child = spawn(process.execPath, ['-e', `import('${join(rootDir, 'dist', 'app.js')}')`], { env: {} });
        let output = '';
        child.stdout.on('data', (chunk) => (output += chunk));
        child.stderr.on('data', (chunk) => (output += chunk));

        assert.equal(await new Promise((resolve) => child.on('close', resolve)), 0);
        assert.equal(output, '');
    });
});
