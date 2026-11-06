import assert from 'assert/strict';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import { after, before, describe, test } from 'node:test';
import os from 'os';
import { dirname, join } from 'path';

import { createApp } from '../dist/app.js';
import { scanAssets } from '../dist/assets.js';
import { reservedNames } from '../dist/config.js';
import { parseConfig } from '../dist/lib/config.js';
import { ROUTES } from '../dist/manifest.js';
import { scan } from '../dist/scan.js';

import { createFixture } from './fixture.mjs';
import { eventually } from './port.mjs';
import { config, freePort, listen, request, rootDir, startServer } from './server.mjs';

const EMPTY = { format: 2, types: [] };

// The release day that makeTree gives to every .versions.json it writes, since a version needs one to be indexed
const DATES = '{ "1.0.0": { "date": "2025-01-01" } }\n';

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
    const assets = scanAssets(parsed.assets, logger);
    const app = createApp(parsed, { index: EMPTY, packagesDir, version: '9.9.9', logger, assets });

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

/**
 * Sends a request written byte for byte over a socket, which the http client would refuse or rewrite.
 * The request line is sent as given, so absolute-form targets, '*' and raw backslashes reach the server unchanged.
 *
 * @param port - Port of a server started by startServer
 * @param line - Request line without its HTTP version, such as GET /npm/lib
 * @param headers - Header lines after Host, which is localhost unless one of them names a Host
 * @returns Status, headers with their names in lower case and the last value of a repeated one, and the body as text;
 * the strings are read as latin1, so each byte is one character, and a server silent for 5 seconds rejects
 */
function send(port, line, headers = []) {
    const lines = [`${line} HTTP/1.1`, ...(headers.some((h) => /^host:/i.test(h)) ? [] : ['Host: localhost'])];
    const text = `${[...lines, ...headers, 'Connection: close'].join('\r\n')}\r\n\r\n`;

    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write(text, 'latin1'));
        const chunks = [];
        socket.setTimeout(5000, () => socket.destroy(new Error('The server did not answer within 5 seconds.')));
        socket.on('data', (chunk) => chunks.push(chunk));
        socket.on('error', reject);
        socket.on('close', () => {
            const [head, ...rest] = Buffer.concat(chunks).toString('latin1').split('\r\n\r\n');
            const [status, ...fields] = head.split('\r\n');
            const pairs = fields.map((field) => [
                field.slice(0, field.indexOf(':')).toLowerCase(),
                field.slice(field.indexOf(':') + 2),
            ]);

            resolve({
                status: Number(status.split(' ')[1]),
                headers: Object.fromEntries(pairs),
                body: rest.join('\r\n\r\n'),
            });
        });
    });
}

/**
 * Writes a tree of small files into a new temporary folder.
 *
 * @param paths - Files to create, relative to the root of the tree and written with a short content
 * @param contents - Text of the files that must not hold the short content, by path; a .versions.json dates 1.0.0
 * @returns The root, and remove() which deletes exactly the entries written here, folders last, never recursively
 */
function makeTree(paths, contents = {}) {
    const root = fs.mkdtempSync(join(os.tmpdir(), 'dropr-reserved-'));
    const created = [];

    for (const path of paths) {
        const file = join(root, path);
        for (let dir = dirname(file); dir !== root && !created.includes(dir); dir = dirname(dir)) created.push(dir);
        fs.mkdirSync(dirname(file), { recursive: true });
        fs.writeFileSync(file, contents[path] ?? (path.endsWith('.versions.json') ? DATES : 'x\n'));
        created.push(file);
    }

    return {
        root,
        remove: () => {
            for (const path of created.sort((a, b) => b.length - a.length)) {
                if (fs.lstatSync(path).isDirectory()) fs.rmdirSync(path);
                else fs.unlinkSync(path);
            }
            fs.rmdirSync(root);
        },
    };
}

/**
 * Scans a tree of one tool per type folder and collects what the scan logs.
 *
 * @param names - Type folder names, none of them differing from another by case alone
 * @param assets - First path segments of the assets, none by default
 * @returns The names of the types that were indexed, sorted, and the messages that were logged, sorted
 */
function scanned(names, assets = []) {
    const tree = makeTree(names.flatMap((name) => [`${name}/tool/1.0.0/a.txt`, `${name}/tool/.versions.json`]));
    const logged = [];

    try {
        const index = scan(tree.root, { error: (message) => logged.push(message) }, assets);

        const skips = logged.filter((line) => line.startsWith('Skipping'));

        return { types: index.types.map(({ name }) => name).sort(), logged: skips.sort() };
    } finally {
        tree.remove();
    }
}

/**
 * Writes the log line of a skipped type folder.
 *
 * @param name - Folder name exactly as scanned, in the case it has on disk
 * @returns The error line of the scan, with the name quoted and the period at the end
 */
function skipped(name) {
    return `Skipping type '${name}': reserved name.`;
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

    test('tells the clients apart by the address of the connection when no header names them', async (t) => {
        const server = await start();
        const from = (localAddress) =>
            new Promise((resolve, reject) => {
                const req = http.get(
                    { host: '127.0.0.1', port: server.port, path: '/health', localAddress, agent: false },
                    (res) => {
                        res.resume();
                        res.on('end', () => resolve(res.statusCode));
                    },
                );
                req.on('error', reject);
            });
        try {
            let status;
            for (let i = 0; i < 101; i++) status = await from('127.0.0.1');
            assert.equal(status, 429);

            try {
                assert.equal(await from('127.0.0.2'), 200);
            } catch (error) {
                if (error.code !== 'EADDRNOTAVAIL') throw error;

                t.skip('127.0.0.2 is not a loopback address here');
            }
        } finally {
            await server.stop();
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

    test('sends no X-Powered-By on a route, an asset, a preflight or an error [change: powered]', async () => {
        const server = await start({ assets: { '/robots.txt': join(rootDir, 'robots.txt') } });
        try {
            for (const [method, path] of [
                ['GET', '/health'],
                ['GET', '/robots.txt'],
                ['OPTIONS', '/'],
                ['GET', '/nope'],
            ]) {
                const { headers } = await request(server.port, method, path);

                assert.equal(headers['x-powered-by'], undefined, `${method} ${path}`);
            }
        } finally {
            await server.stop();
        }
    });

    test('logs an asset and a preflight like every other request [change: logged]', async () => {
        const server = await start({ assets: { '/robots.txt': join(rootDir, 'robots.txt') } });
        try {
            await request(server.port, 'GET', '/robots.txt');
            await request(server.port, 'OPTIONS', '/npm');
            await request(server.port, 'GET', '/health');

            assert.equal(await eventually(() => server.logs.requests.length === 3), true);
            assert.deepEqual(
                server.logs.requests.map(({ method, url, status }) => `${method} ${url} ${status}`).sort(),
                ['GET /health 200', 'GET /robots.txt 200', 'OPTIONS /npm 204'],
            );
        } finally {
            await server.stop();
        }
    });

    test('the logger gets every request, and the scan messages of startServer', async () => {
        const server = await startServer(join(fixture.root, 'missing'));
        try {
            await request(server.port, 'GET', '/npm');

            assert.equal(await eventually(() => server.logs.requests.length === 1), true);
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

describe('dist/bin.js serve', () => {
    let fixture;

    before(() => (fixture = createFixture()));
    after(() => fixture?.remove());

    /**
     * Runs the entry point in a child process until it exits or listens.
     *
     * @param args - Arguments after the serve command
     * @param env - Env added to the one of the test, which cannot leak PORT or PACKAGES_DIR in
     * @param probe - Called once the child reports it is running, which is killed after it settles
     * @param cwd - Working folder of the child, the one of the test by default
     * @returns Exit code, stdout, stderr and the value of probe; a child still listening is killed and reports a null
     * code, and one that neither exits nor listens within 10 seconds is killed and rejects with its stderr
     */
    function run(args = [], env = {}, probe = undefined, cwd = undefined) {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [join(rootDir, 'dist', 'bin.js'), 'serve', ...args], {
                cwd,
                env: { ...process.env, PORT: '', PACKAGES_DIR: '', ...env },
            });
            let stdout = '';
            let stderr = '';
            let probed;
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`bin.js neither exited nor listened within 10 seconds: ${stderr}`));
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

    test('listens on PORT, serving --packages, and prints that it is running', async () => {
        const port = await freePort();
        const env = { PORT: String(port) };
        const { stdout, probed } = await run(['--packages', join(fixture.root, 'packages')], env, async () => ({
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

    test('reserves the first segment of every asset, skipping its type folder', async () => {
        const port = await freePort();
        const config = { manifest: { baseUrl: 'https://cdn.example.com' }, assets: { '/static/logo.txt': 'logo.txt' } };
        const files = [
            'packages/static/tool/1.0.0/a.txt',
            'packages/static/tool/.versions.json',
            'packages/npm/lib/1.0.0/b.txt',
            'packages/npm/lib/.versions.json',
            'logo.txt',
            'config.json',
        ];
        const tree = makeTree(files, { 'config.json': JSON.stringify(config) });

        try {
            const { stderr, probed } = await run(
                [join(tree.root, 'config.json')],
                { PORT: String(port) },
                async () => ({
                    asset: await request(port, 'GET', '/static/logo.txt'),
                    skipped: await request(port, 'GET', '/static/tool@1.0.0/a.txt'),
                    kept: await request(port, 'GET', '/npm/lib@1.0.0/b.txt'),
                }),
            );

            assert.equal(stderr.split('\n')[0], "Skipping type 'static': reserved name.");
            assert.equal(probed.asset.status, 200);
            assert.equal(probed.skipped.status, 404);
            assert.equal(JSON.parse(probed.skipped.body).message, "Package type 'static' does not exist.");
            assert.equal(probed.kept.status, 200);
        } finally {
            tree.remove();
        }
    });

    test('ignores PACKAGES_DIR and serves the packagesDir of the config [change: packagesenv]', async () => {
        const port = await freePort();
        const files = ['packages/npm/lib/1.0.0/b.txt', 'packages/npm/lib/.versions.json', 'config.json'];
        const tree = makeTree(files, {
            'config.json': JSON.stringify({ manifest: { baseUrl: 'https://cdn.example.com' } }),
        });

        try {
            const env = { PORT: String(port), PACKAGES_DIR: join(tree.root, 'missing') };
            const { probed } = await run([join(tree.root, 'config.json')], env, async () =>
                request(port, 'GET', '/npm/lib@1.0.0/b.txt'),
            );

            assert.equal(probed.status, 200);
        } finally {
            tree.remove();
        }
    });

    test('reads dropr.config.json of the working folder, then the defaults [change: configpath]', async () => {
        const files = ['packages/npm/lib/1.0.0/b.txt', 'packages/npm/lib/.versions.json', 'dropr.config.json'];
        const named = makeTree(files, {
            'dropr.config.json': JSON.stringify({ name: 'folder', manifest: { baseUrl: 'https://cdn.example.com' } }),
        });
        const bare = makeTree(['keep.txt']);
        const port = await freePort();

        try {
            const found = await run(
                [],
                { PORT: String(port) },
                () => request(port, 'GET', '/npm/lib@1.0.0/b.txt'),
                named.root,
            );
            assert.match(found.stdout, /^folder is running on\n/);
            assert.equal(found.probed.status, 200);

            const defaults = await run(
                [],
                { PORT: String(port) },
                async () => JSON.parse((await request(port, 'GET', '/health')).body),
                bare.root,
            );
            assert.match(defaults.stdout, /^dropr is running on\n/);
            assert.equal(defaults.probed.packages, 0);

            const missing = await run([join(bare.root, 'nope.json')]);
            assert.equal(missing.code, 1);
            assert.match(missing.stderr, /^Invalid config: .*nope\.json cannot be read/);
        } finally {
            named.remove();
            bare.remove();
        }
    });

    test('fails without the banner when the port is taken', async () => {
        const taken = net.createServer();
        await new Promise((resolve) => taken.listen(0, resolve));

        try {
            const { port } = taken.address();
            const { code, stdout, stderr } = await run(['--packages', join(fixture.root, 'packages')], {
                PORT: String(port),
            });

            assert.equal(code, 1);
            assert.equal(stdout, '');
            assert.match(stderr, /EADDRINUSE/);
        } finally {
            await new Promise((resolve) => taken.close(resolve));
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

describe('request shapes of the adapter', () => {
    let fixture;
    let server;
    let errors;

    before(async () => {
        fixture = createFixture();
        server = await startServer(fixture.packagesDir);
        errors = server.logs.errors.length;
    });

    after(async () => {
        await server?.stop();
        fixture?.remove();
    });

    test('an absolute-form target routes on its path and query only, whatever its authority', async () => {
        const file = await send(server.port, 'GET http://other.example/npm/lib@1.2.0/index.js?x=1');
        const empty = await send(server.port, 'GET http://other.example/npm//lib?x=1');
        const authorities = ['http:///npm/lib', 'http://x:99999/npm/lib', 'https://u:p@[::1]:80/npm/lib'];
        const schemes = ['HTTP://other.example', 'Http://other.example', 'HTTPS://other.example'];

        assert.deepEqual([file.status, file.body], [200, 'export default "1.2.0";\n']);
        assert.equal(empty.status, 404);
        assert.equal(JSON.parse(empty.body).message, "Route '/npm//lib' does not exist.");
        for (const target of authorities) {
            const response = await send(server.port, `GET ${target}`);

            assert.equal(JSON.parse(response.body).message, "Available versions for the 'lib' project.", target);
        }
        for (const origin of schemes) {
            const response = await send(server.port, `GET ${origin}/npm/lib@1.2.0/index.js`);

            assert.deepEqual([response.status, response.body], [200, 'export default "1.2.0";\n'], origin);
        }
        for (const target of ['http://other.example', 'http://other.example?x=1']) {
            const response = await send(server.port, `GET ${target}`);

            assert.match(JSON.parse(response.body).message, /^Use the following routes/, target);
        }
    });

    test('GET * is a missing route and OPTIONS * is answered by CORS', async () => {
        const star = await send(server.port, 'GET *');
        const options = await send(server.port, 'OPTIONS *', ['Origin: https://example.com']);

        assert.equal(star.status, 404);
        assert.equal(JSON.parse(star.body).message, "Package type '*' does not exist.");
        assert.deepEqual([options.status, options.headers['access-control-allow-origin']], [204, '*']);
    });

    test('Host and X-Forwarded-Host never reach the routing', async () => {
        const control = await send(server.port, 'GET /npm/lib');
        const lines = [
            ['Host: bad host!'],
            ['Host: [::1]:4000'],
            ['Host: npm'],
            ['X-Forwarded-Host: evil.example/npm'],
        ];

        assert.equal(control.status, 200);
        for (const headers of lines) {
            const response = await send(server.port, 'GET /npm/lib', headers);

            assert.deepEqual([response.status, response.body], [control.status, control.body], headers.join());
        }
    });

    test('a matching If-None-Match gives 304, also when Node joined it from a repeated header', async () => {
        const path = 'GET /npm/lib@1.2.0/index.js';
        const { etag } = (await send(server.port, path)).headers;

        assert.equal((await send(server.port, path, [`If-None-Match: ${etag}`])).status, 304);
        assert.equal((await send(server.port, path, [`If-None-Match: ${etag}`, 'If-None-Match: "other"'])).status, 304);
        assert.equal((await send(server.port, path, ['If-None-Match: "a"', 'If-None-Match: "b"'])).status, 200);
    });

    test('a header value of any byte is answered by the core or refused by Node, never a failure', async () => {
        for (let byte = 0; byte < 256; byte++) {
            const headers = [`X-Byte: a${String.fromCharCode(byte)}b`, `X-Test-Client: 10.8.0.${byte}`];
            const response = await send(server.port, 'GET /npm/lib', headers);

            assert.ok([200, 400].includes(response.status), `byte ${byte} gives ${response.status}`);
        }
    });

    test('a doubled slash is an empty segment, never a host', async () => {
        const response = await send(server.port, 'GET //npm/lib');

        assert.equal(response.status, 404);
        assert.equal(JSON.parse(response.body).message, "Route '//npm/lib' does not exist.");
    });

    test('a backslash reads as a slash and a fragment is cut', async () => {
        const file = await send(server.port, 'GET /npm/lib@1.2.0/dist\\index.mjs');
        const versions = await send(server.port, 'GET /npm\\lib');
        const fragment = await send(server.port, 'GET /npm/lib@1.2.0/index.js#top');

        assert.deepEqual([file.status, file.body], [200, 'export default "1.2.0";\n']);
        assert.equal(JSON.parse(versions.body).message, "Available versions for the 'lib' project.");
        assert.deepEqual([fragment.status, fragment.body], [200, 'export default "1.2.0";\n']);
    });

    test('TRACE is refused with the 405 of the core', async () => {
        const response = await send(server.port, 'TRACE /npm/lib');

        assert.deepEqual([response.status, response.headers.allow], [405, 'GET, HEAD, OPTIONS']);
    });

    test('none of these requests is logged as an error', () => {
        assert.equal(server.logs.errors.length, errors);
    });
});

describe('reserved names', () => {
    test('a type folder named like a route or an asset is skipped and logged', () => {
        const { types, logged } = scanned(['download', 'search', 'health', 'manifest', 'static', 'npm'], ['static']);

        assert.deepEqual(types, ['npm']);
        assert.deepEqual(logged, ['download', 'health', 'manifest', 'search', 'static'].map(skipped));
    });

    test('every reserved name is compared exactly [change: reserved]', () => {
        const { types, logged } = scanned(['Download', 'Search', 'Health', 'MANIFEST', 'STATIC', 'npm'], ['static']);

        assert.deepEqual(types, ['Download', 'Health', 'MANIFEST', 'STATIC', 'Search', 'npm']);
        assert.deepEqual(logged, []);
    });

    test('a type folder named Download is served, since only download is a route', async () => {
        const tree = makeTree(['Download/tool/1.0.0/a.txt', 'Download/tool/.versions.json']);
        const server = await startServer(tree.root, { assets: {} });

        try {
            const file = await request(server.port, 'GET', '/Download/tool@1.0.0/a.txt');
            const versions = await request(server.port, 'GET', '/Download/tool');

            assert.deepEqual([file.status, file.body.toString()], [200, 'x\n']);
            assert.equal(versions.status, 200);
        } finally {
            await server.stop();
            tree.remove();
        }
    });

    test('the first segment of every asset URL is reserved, an asset served at the root reserves nothing', () => {
        const assets = { '/favicon.ico': 'a', '/static/logo.svg': 'b', '/': 'c' };

        assert.deepEqual(reservedNames({ assets }), ['favicon.ico', 'static']);
    });
});

describe('streamed bodies', () => {
    let fixture;

    before(() => (fixture = createFixture()));
    after(() => fixture?.remove());

    test('the headers of a file reach the client before its first byte is read', async () => {
        const stalled = async () => new ReadableStream({ pull: () => new Promise(() => {}) });
        const server = await startServer(fixture.packagesDir, {}, { read: stalled });

        try {
            const status = await new Promise((resolve, reject) => {
                const req = http.get(
                    { host: '127.0.0.1', port: server.port, path: '/npm/lib@1.2.0/index.js', agent: false },
                    (res) => {
                        resolve(res.statusCode);
                        req.destroy();
                    },
                );
                req.on('error', reject);
                setTimeout(() => resolve('no headers within 3 seconds'), 3000).unref();
            });

            assert.equal(status, 200);
        } finally {
            await server.stop();
        }
    });

    test('a failure after the headers resets the connection, which a plain close would hide from HTTP/1.0', async () => {
        const cut = async () => {
            let pulled = 0;

            return new ReadableStream(
                {
                    pull(controller) {
                        if (pulled++ === 0) controller.enqueue(new Uint8Array(4));
                        else controller.error(new Error('disk'));
                    },
                },
                { highWaterMark: 0 },
            );
        };
        const server = await startServer(fixture.packagesDir, {}, { read: cut });

        try {
            const outcome = await new Promise((resolve) => {
                const socket = net.connect(server.port, '127.0.0.1', () => {
                    socket.write('GET /npm/lib@1.2.0?download HTTP/1.0\r\n\r\n');
                });
                socket.on('data', () => {});
                socket.on('error', (error) => resolve(error.code));
                socket.on('end', () => resolve('ended'));
            });

            assert.equal(outcome, 'ECONNRESET');
        } finally {
            await server.stop();
        }
    });

    test('logs a request whose client leaves with the last byte, before the body ends', async () => {
        const text = Buffer.from('export default "1.2.0";\n');
        let sent = false;
        let left = false;
        const late = async () =>
            new ReadableStream({
                pull: (controller) => {
                    if (!sent) {
                        sent = true;

                        return controller.enqueue(new Uint8Array(text));
                    }

                    return new Promise((resolve) =>
                        setTimeout(() => {
                            if (!left) controller.close();
                            resolve();
                        }, 100),
                    );
                },
                cancel: () => void (left = true),
            });
        const server = await startServer(fixture.packagesDir, {}, { read: late });

        try {
            await new Promise((resolve, reject) => {
                const req = http.get(
                    { host: '127.0.0.1', port: server.port, path: '/npm/lib@1.2.0/index.js', agent: false },
                    (res) => {
                        let got = 0;
                        res.on('data', (chunk) => {
                            got += chunk.length;
                            if (got !== text.length) return;

                            req.destroy();
                            resolve();
                        });
                    },
                );
                req.on('error', () => undefined);
                setTimeout(() => reject(new Error('the body did not arrive')), 3000).unref();
            });

            assert.equal(await eventually(() => server.logs.requests.length === 1), true);
            assert.deepEqual(
                server.logs.requests.map(({ method, url, status }) => `${method} ${url} ${status}`),
                ['GET /npm/lib@1.2.0/index.js 200'],
            );
        } finally {
            await server.stop();
        }
    });

    test('a failure after the headers closes a connection that cannot be reset, and the server goes on', async () => {
        const path = join(fixture.root, 'dropr.sock');
        const cut = async () =>
            new ReadableStream({
                pull(controller) {
                    controller.error(new Error('disk'));
                },
            });
        const logs = { errors: [] };
        const logger = { request() {}, error: (...args) => logs.errors.push(args) };
        const index = scan(fixture.packagesDir, { error() {} });
        const server = http.createServer(
            createApp(config, { index, packagesDir: fixture.packagesDir, version: '9.9.9', logger, read: cut }),
        );
        await new Promise((resolve) => server.listen(path, resolve));

        try {
            const outcome = await new Promise((resolve) => {
                const req = http.get({ socketPath: path, path: '/npm/lib@1.2.0/index.js', agent: false }, (res) => {
                    res.on('error', () => resolve('aborted'));
                    res.on('close', () => resolve(res.complete ? 'complete' : 'aborted'));
                    res.resume();
                });
                req.on('error', () => resolve('aborted'));
                setTimeout(() => resolve('hung'), 3000).unref();
            });

            assert.equal(outcome, 'aborted');
            assert.deepEqual(logs.errors, [['File error on npm/lib/1.2.0/index.js:', 'disk']]);
        } finally {
            await new Promise((resolve) => (server.close(resolve), server.closeAllConnections()));
        }
    });
});
