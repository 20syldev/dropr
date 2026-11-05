import assert from 'assert/strict';
import fs from 'fs';
import { after, before, describe, mock, test } from 'node:test';
import { join } from 'path';

import { archiveEntries, archiveStream } from '../dist/lib/archive.js';
import { compareVersions, loadIndex } from '../dist/lib/packages.js';
import { createLimiter } from '../dist/lib/ratelimit.js';
import { route } from '../dist/lib/route.js';
import { scan } from '../dist/scan.js';

import { caseName, CASES, HEADERS, readBody } from './cases.mjs';
import { createFixture } from './fixture.mjs';
import { rootDir } from './server.mjs';
import { collect } from './tar.mjs';

// Snapshot headers written by Express or send, which the core leaves to the adapter
const ADAPTER_HEADERS = ['accept-ranges', 'content-length', 'content-range'];

// Request headers that send or the freshness check of Express answer, so their cases depend on the adapter
const CONDITIONALS = ['if-match', 'if-modified-since', 'if-none-match', 'if-range', 'if-unmodified-since', 'range'];

// Date of every file of the synthetic indexes (2025-01-01T12:00:00Z), in milliseconds
const TIME = 1735732800000;

// SHA-256 of an empty file, the hash of every synthetic file
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// Names that an object treats apart (integer-like keys, the prototype setter, an inherited key), in strcmp order
const NAMES = ['10', '9', '__proto__', 'constructor'];

// Refusal of a client past 100 requests within 10 seconds
const PER_CLIENT = 'You have exceeded the limit of 100 requests per 10 seconds.';

// Entries recorded by routes.test.mjs, which route() reproduces for the cases it decides alone
const snapshot = loadSnapshot(join(rootDir, 'test', 'routes.test.mjs.snapshot'));

let fixture;
let index;
let catalog;
let logged;

/**
 * Loads a snapshot file of node:test, which assigns each serialized value to exports under its key.
 *
 * @param file - Snapshot file of the repository, run as code
 * @returns Map of snapshot keys to their values, parsed back from JSON
 */
function loadSnapshot(file) {
    const exports = {};
    new Function('exports', fs.readFileSync(file, 'utf-8'))(exports);

    return new Map(Object.entries(exports).map(([key, value]) => [key, JSON.parse(value)]));
}

/**
 * Builds the request that the adapter hands to route() for a case, without calling the adapter.
 * The URL is the raw target after the origin, so the snapshot of the HTTP server also checks what the adapter builds.
 *
 * @param entry - Case whose path is the raw request target, GET and without request headers by default
 * @returns The method, the URL of the target on http://localhost, and the headers as a Headers object
 */
function toRequest({ path: target, method = 'GET', headers = {} }) {
    return { method, url: `http://localhost${target}`, headers: new Headers(headers) };
}

/**
 * Tells whether the core alone decides the answer to a case, so that it can be replayed without the adapter.
 *
 * @param entry - Case from CASES
 * @returns False for a static file, OPTIONS, a locked case, and a conditional or range request
 */
function isCoreCase({ method, headers = {}, locked, checkout }) {
    if (checkout || locked || method === 'OPTIONS') return false;

    return !Object.keys(headers).some((name) => CONDITIONALS.includes(name));
}

/**
 * Produces the bytes that the adapter sends for a body of the core.
 *
 * @param body - Body from route()
 * @param packagesDir - Packages folder that file paths and archive sources are relative to
 * @returns The JSON text, the file read from disk, nothing for an empty body, or the archive from the tar writer;
 * null when the archive stream errors, which the adapter turns into a reset
 */
async function sentBytes(body, packagesDir) {
    if (body.kind === 'json') return Buffer.from(body.text);
    if (body.kind === 'file') return fs.readFileSync(join(packagesDir, body.path));
    if (body.kind === 'empty') return Buffer.alloc(0);

    try {
        return await collect(archiveStream(body.entries, (source) => fs.promises.readFile(join(packagesDir, source))));
    } catch {
        return null;
    }
}

/**
 * Answers a case in process and records it as capture() records the same case served over HTTP.
 *
 * @param entry - Case as in CASES, answered from the catalog of the fixture
 * @returns Status, the headers of the core in lower case, and the body decoded by readBody, empty for HEAD, or
 * aborted when the archive stream errors
 */
async function respond(entry) {
    const response = route(toRequest(entry), catalog);
    const { status } = response;
    const headers = Object.fromEntries(
        Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]),
    );

    // HEAD ends after the headers, so neither the file nor the archive is read
    const bytes = entry.method === 'HEAD' ? Buffer.alloc(0) : await sentBytes(response.body, fixture.packagesDir);
    if (bytes === null) return { status, headers, aborted: true };

    return { status, headers, body: readBody({ status, headers, body: bytes }) };
}

/**
 * Reads a snapshot entry of the route tests, reduced to what the core decides.
 *
 * @param key - Snapshot key, the suite and test names followed by the entry number
 * @returns Status, the recorded headers other than the adapter ones and the weak ETag, and the body or aborted;
 * throws when the snapshot has no such entry
 */
function recorded(key) {
    assert.ok(snapshot.has(key), `the snapshot has no entry ${key}`);

    const { headers, ...rest } = snapshot.get(key);
    const owned = Object.entries(headers).filter(
        ([name, value]) => HEADERS.includes(name) && !ADAPTER_HEADERS.includes(name) && value !== 'W/<weak>',
    );

    return { ...rest, headers: Object.fromEntries(owned) };
}

/**
 * Builds a file node of a synthetic index, empty and without the execute bit.
 *
 * @param name - File name
 * @returns The file node, dated TIME and hashed as an empty file
 */
function file(name) {
    return { kind: 'file', name, mtime: TIME, size: 0, exec: false, sha256: EMPTY_SHA256 };
}

/**
 * Builds a folder node of a synthetic index.
 *
 * @param name - Folder name
 * @param entries - Nodes of the folder in strcmp order, null for a folder that could not be listed
 * @returns The folder node, its size 0 or null when it could not be listed
 */
function folder(name, entries) {
    return { kind: 'dir', name, size: entries === null ? null : 0, entries };
}

/**
 * Builds a link node of a synthetic index.
 *
 * @param name - Link name
 * @param target - Raw target, as readlink gives it
 * @param real - Real target relative to the version folder, '' for the folder itself, null when it dangles, loops or
 * escapes
 * @returns The link node
 */
function link(name, target, real) {
    return { kind: 'link', name, target, real };
}

/**
 * Builds a version of a synthetic index, released on 2025-01-01.
 *
 * @param name - Version name, also the name of its root folder
 * @param entries - Nodes of the version folder in strcmp order
 * @returns The version node
 */
function version(name, entries) {
    return { name, date: '2025-01-01', root: folder(name, entries) };
}

/**
 * Loads a synthetic index of one type, npm, whose projects each have one version 1.0.0.
 *
 * @param projects - Pairs of a project name and the root entries of its version, null for a project without versions
 * @param deprecated - Notice given to every project, none by default
 * @returns The catalog of the index
 */
function catalogOf(projects, deprecated = null) {
    const nodes = projects.map(([name, entries]) => ({
        name,
        deprecated,
        versions: entries ? [version('1.0.0', entries)] : [],
    }));

    return loadIndex({ format: 1, types: [{ name: 'npm', projects: nodes }] });
}

/**
 * Sends a GET request to route().
 *
 * @param target - Request target, its query after the first '?'
 * @param from - Catalog to answer from
 * @returns Status, headers as the core set them, and the JSON body parsed, or the body itself when it is not JSON
 */
function get(target, from) {
    const { status, headers, body } = route(toRequest({ path: target }), from);

    return { status, headers, body: body.kind === 'json' ? JSON.parse(body.text) : body };
}

before(() => {
    fixture = createFixture();

    const error = mock.method(console, 'error', () => {});
    try {
        index = scan(fixture.packagesDir);
    } finally {
        logged = error.mock.calls.map((call) => call.arguments[0]);
        error.mock.restore();
    }

    catalog = loadIndex(JSON.parse(JSON.stringify(index)));
});

after(() => fixture?.remove());

describe('scan', () => {
    test('the index survives a JSON round trip and loads into the same catalog', () => {
        const copy = JSON.parse(JSON.stringify(index));

        assert.deepEqual(copy, index);
        assert.deepEqual(loadIndex(copy), loadIndex(index));
    });

    test('a version with a file or a folder that cannot be read is logged and left out', () => {
        const versions = ['npm/broken/1.0.0', 'npm/sealed/1.0.0'];
        const reads = ['npm/broken/1.0.0/locked.bin', 'npm/sealed/1.0.0/vault'].map((path) =>
            join(fixture.packagesDir, path),
        );
        const left = versions.map(
            (path) => `Skipping version ${join(fixture.packagesDir, path)}: it could not be read whole.`,
        );
        const lines = logged.filter((line) => !line.startsWith('No release date'));

        assert.deepEqual(lines, [
            "Skipping type 'download': reserved name.",
            ...(fixture.locked ? [`Error reading ${reads[0]}:`, left[0], `Error reading ${reads[1]}:`, left[1]] : []),
        ]);
        for (const version of versions) assert.equal(catalog.versions.has(version), !fixture.locked, version);
    });

    test('a file with the owner execute bit is archived with mode 0755, any other file with 0644', () => {
        const entries = archiveEntries(catalog.versions.get('bash/gft/1.2.0'));

        assert.deepEqual(
            entries.map(({ path, mode }) => [path, mode]),
            [
                ['1.2.0/', 0o755],
                ['1.2.0/README.md', 0o644],
                ['1.2.0/gft', 0o755],
            ],
        );
    });

    test('loadIndex refuses an index of another format', () => {
        assert.throws(() => loadIndex({ format: 2, types: [] }), /Unsupported packages index format: 2/);
    });
});

describe('route() against routes.test.mjs.snapshot', () => {
    for (const entry of CASES.filter(isCoreCase)) {
        test(caseName(entry), async () => {
            assert.deepEqual(await respond(entry), recorded(`routes > ${caseName(entry)} 1`));
        });
    }

    test('GET /npm/lib@1.2.0/index.js (if-none-match: its etag)', async (t) => {
        const path = '/npm/lib@1.2.0/index.js';
        const etag = route(toRequest({ path }), catalog).headers.ETag;

        assert.deepEqual(await respond({ path, headers: { 'if-none-match': etag } }), recorded(`routes > ${t.name} 1`));
    });

    test('GET /npm/links@1.0.0/dist/loop/... (index.js after 40 and 41 link crossings, dist after 41)', async (t) => {
        const loop = 'dist/loop/';
        const paths = [`${loop.repeat(40)}index.js`, `${loop.repeat(41)}index.js`, `${loop.repeat(41)}dist`];

        for (const [i, path] of paths.entries()) {
            assert.deepEqual(
                await respond({ path: `/npm/links@1.0.0/${path}` }),
                recorded(`routes > ${t.name} ${i + 1}`),
            );
        }
    });
});

describe('route() on synthetic indexes', () => {
    test('a project without versions: its archive fails at once, @latest gives 500, its changelog is empty', async () => {
        const empty = catalogOf([['empty', null]]);
        const download = get('/download/npm/empty', empty);

        assert.equal(download.status, 200);
        assert.equal(download.headers['Content-Disposition'], 'attachment; filename="empty-null.tar.gz"');
        assert.deepEqual(download.body, { kind: 'archive', key: 'npm/empty/null', entries: null });
        await assert.rejects(collect(archiveStream(null, () => assert.fail('nothing is read'))), /could not be read/);

        assert.equal(get('/npm/empty@latest', empty).status, 500);
        assert.equal(get('/npm/empty@latest?download', empty).status, 500);
        assert.equal(get('/npm/empty@latest/index.js', empty).status, 500);
        assert.deepEqual(get('/npm/empty', empty).body.versions, { latest: '/npm/empty@latest' });

        const changelog = get('/npm/empty/changelog', empty);
        assert.equal(changelog.status, 200);
        assert.equal(changelog.body.versions, 0);
        assert.deepEqual(changelog.body.changelog, []);
    });

    test('names 10, 9, __proto__ and constructor keep the key order and own keys of plain objects', () => {
        const root = NAMES.map((name) => file(name));
        const versions = [...NAMES].sort(compareVersions).map((name) => version(name, root));
        const projects = NAMES.map((name) => ({ name, deprecated: null, versions }));
        const odd = loadIndex({ format: 1, types: NAMES.map((name) => ({ name, projects })) });

        assert.deepEqual(Object.keys(get('/', odd).body.packages), ['9', '10', 'constructor']);
        assert.deepEqual(Object.keys(get('/download', odd).body.downloads), ['9', '10', 'constructor']);
        assert.equal(get('/__proto__', odd).body.message, "Package type '__proto__' does not exist.");
        assert.equal(get('/constructor', odd).status, 200);

        assert.deepEqual(Object.keys(get('/9', odd).body.projects), ['9', '10', 'list', 'constructor']);
        assert.equal(get('/9/__proto__', odd).body.message, "Project '__proto__' does not exist in /9.");
        assert.equal(get('/9/constructor', odd).status, 200);

        assert.deepEqual(Object.keys(get('/9/10', odd).body.versions), ['9', '10', 'latest', 'constructor']);
        assert.equal(get('/9/10@latest', odd).body.current, '10@10');
        assert.equal(get('/9/10@__proto__', odd).body.message, "Version __proto__ does not exist in the '10' project.");
        assert.equal(get('/9/10@constructor', odd).body.current, '10@constructor');

        const listing = get('/9/10@9', odd).body.files.map(({ name }) => name);
        assert.deepEqual(listing, NAMES);
        const sums = get('/9/10@9?checksums', odd).body.checksums;
        assert.deepEqual(Object.keys(sums), ['9', '10', '__proto__', 'constructor']);
        assert.equal(get('/9/10@9/__proto__', odd).body.path, '9/10/9/__proto__');
        assert.equal(get('/9/10@9/constructor', odd).body.path, '9/10/9/constructor');
    });

    test('the ETag of a file is its quoted SHA-256, so equal sizes and dates with other bytes give other tags', () => {
        const first = { ...file('a.js'), size: 4, sha256: 'a'.repeat(64) };
        const second = { ...file('b.js'), size: 4, sha256: 'b'.repeat(64) };
        const same = { ...file('c.js'), size: 9, mtime: TIME + 1, sha256: 'a'.repeat(64) };
        const bytes = catalogOf([['p', [first, second, same]]]);

        assert.equal(get('/npm/p@1.0.0/a.js', bytes).headers.ETag, `"${'a'.repeat(64)}"`);
        assert.equal(get('/npm/p@1.0.0/b.js', bytes).headers.ETag, `"${'b'.repeat(64)}"`);
        assert.equal(get('/npm/p@1.0.0/c.js', bytes).headers.ETag, get('/npm/p@1.0.0/a.js', bytes).headers.ETag);
    });

    test('a file without a hash has no ETag from the core, and no tag makes it answer 304', () => {
        const unread = { ...file('unread.js'), sha256: null };
        const unhashed = catalogOf([['p', [unread, link('alias', 'unread.js', 'unread.js')]]]);

        for (const path of ['unread.js', 'alias']) {
            const answer = route(toRequest({ path: `/npm/p@1.0.0/${path}` }), unhashed);
            const conditional = { path: `/npm/p@1.0.0/${path}`, headers: { 'if-none-match': '"null"' } };

            assert.equal(answer.status, 200, path);
            assert.equal(answer.headers.ETag, undefined, path);
            assert.equal(route(toRequest(conditional), unhashed).status, 200, path);
        }
    });

    test('a link chain resolves to its file, a link to itself is never served nor listed', () => {
        const links = [
            link('first', 'second', 'file.js'),
            link('second', 'file.js', 'file.js'),
            link('self', 'self', null),
        ];
        const chain = catalogOf([['p', [file('file.js'), ...links]]]);
        const files = { 'file.js': EMPTY_SHA256, first: EMPTY_SHA256, second: EMPTY_SHA256 };

        assert.equal(get('/npm/p@1.0.0/first', chain).body.path, 'npm/p/1.0.0/file.js');
        assert.equal(get('/npm/p@1.0.0/self', chain).status, 404);
        assert.deepEqual(
            get('/npm/p@1.0.0', chain).body.files.map(({ name }) => name),
            ['file.js', 'first', 'second'],
        );
        assert.deepEqual(get('/npm/p@1.0.0?checksums', chain).body.checksums, files);
        assert.deepEqual(
            get('/npm/p@1.0.0?download', chain).body.entries.map(({ path, target }) => [path, target]),
            [
                ['1.0.0/', null],
                ['1.0.0/file.js', null],
                ['1.0.0/first', 'second'],
                ['1.0.0/second', 'file.js'],
                ['1.0.0/self', 'self'],
            ],
        );
    });

    test('a path may cross 40 links: past them a file gives 404 with nosniff, even with its tag, and a folder 500', () => {
        const loops = catalogOf([['p', [folder('dist', [link('loop', '..', '')]), file('index.js')]]]);
        const loop = 'dist/loop/';

        assert.equal(get(`/npm/p@1.0.0/${loop.repeat(40)}index.js`, loops).status, 200);
        assert.equal(get(`/npm/p@1.0.0/${loop.repeat(40)}dist`, loops).status, 200);

        const past = get(`/npm/p@1.0.0/${loop.repeat(41)}index.js`, loops);
        assert.equal(past.status, 404);
        assert.deepEqual(past.headers, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
        });
        assert.equal(get(`/npm/p@1.0.0/${loop.repeat(41)}dist`, loops).status, 500);

        const tag = get(`/npm/p@1.0.0/${loop.repeat(40)}index.js`, loops).headers.ETag;
        const request = toRequest({
            path: `/npm/p@1.0.0/${loop.repeat(41)}index.js`,
            headers: { 'if-none-match': tag },
        });
        assert.equal(route(request, loops).status, 404);
    });

    test('a path that climbs above the root stops there, and one that climbs into another project names it', () => {
        const tree = catalogOf([['p', [file('index.js')]]]);

        assert.equal(get('/npm/p@1.0.0/../../../../npm/p@1.0.0/index.js', tree).status, 200);
        assert.equal(get('/npm/p@1.0.0/../../../../../../npm/p@1.0.0/index.js', tree).status, 200);

        const other = get('/npm/p@1.0.0/../q@1.0.0/index.js', tree);
        assert.equal(other.status, 404);
        assert.equal(other.body.message, "Project 'q' does not exist in /npm.");
        assert.equal(
            get('/npm/p@1.0.0/../../../npm/p/1.0.0/index.js', tree).body.message,
            "Route '/npm/p/1.0.0/index.js' does not exist.",
        );
    });

    test('a link to a folder that could not be listed gives 500, a path below it 404', () => {
        const sealed = catalogOf([['p', [link('door', 'vault', 'vault'), file('index.js'), folder('vault', null)]]]);

        assert.equal(get('/npm/p@1.0.0/door', sealed).status, 500);
        assert.equal(get('/npm/p@1.0.0/door/key.txt', sealed).status, 404);
        assert.equal(get('/npm/p@1.0.0/vault', sealed).status, 500);
        assert.deepEqual(get('/npm/p@1.0.0', sealed).body.files, [
            { name: 'door/', size: null, directory: true },
            { name: 'index.js', size: 0, directory: false },
            { name: 'vault/', size: null, directory: true },
        ]);
        assert.equal(get('/npm/p@1.0.0?checksums', sealed).status, 500);
        assert.equal(get('/npm/p@1.0.0?download', sealed).body.entries, null);
    });

    test('a segment that does not decode gives 400 with one fixed message, no header and before any 404', () => {
        const notice = { date: '2025-06-01', message: 'Renamed.', successor: 'https://example.com/lib' };
        const old = catalogOf([['old', [file('index.js')]]], notice);
        const targets = [
            '/download/%E0',
            '/download/npm/%E0',
            '/%E0',
            '//%E0',
            '/npm/%E0/changelog',
            '/npm/%E0',
            '/npm/%E0/x',
            '/nope/%E0',
            '/npm/old@1.0.0/dist/%E0/x',
            '/npm/old/%E0',
        ];

        for (const target of targets) {
            const { status, headers, body } = get(target, old);
            assert.equal(status, 400, target);
            assert.equal(body.message, 'The path holds an invalid percent-encoding.', target);
            assert.deepEqual(Object.keys(headers), ['Content-Type'], target);
        }
    });

    test('a request URL that does not parse, or is not http or https, gives 400', () => {
        for (const url of ['not a url', 'data:text/plain,x', 'mailto:x', 'ftp://host/npm/lib', 'file:///npm/lib']) {
            const response = route({ method: 'GET', url, headers: new Headers() }, catalog);

            assert.equal(response.status, 400, url);
            assert.equal(JSON.parse(response.body.text).message, 'The request URL is not valid.', url);
        }
    });

    test('a query of over 1000 keys still holds q and checksums, a repeated q is missing', () => {
        const keys = Array.from({ length: 1200 }, (_, i) => `k${i}=1`).join('&');

        assert.equal(get(`/search?${keys}&q=lib`, catalog).status, 200);
        assert.deepEqual(Object.keys(get(`/npm/lib@1.2.0?${keys}&checksums`, catalog).body), [
            'name',
            'version',
            'algorithm',
            'checksums',
        ]);
        assert.equal(get('/search?q=lib&q=lib', catalog).status, 400);
    });

    test('the value of q is form-decoded once, so + is a space and %2B and %25 are a plus and a percent', () => {
        const queries = [
            ['a+b', 'a b'],
            ['a%20b', 'a b'],
            ['a%2Bb', 'a+b'],
            ['%25', '%'],
            ['%2541', '%41'],
            ['%E0', '\uFFFD'],
            ['%', '%'],
        ];

        for (const [raw, query] of queries) {
            const { status, body } = get(`/search?q=${raw}`, catalog);

            assert.deepEqual([status, body.query], [200, query], raw);
        }
    });
});

describe('createLimiter', () => {
    test('a client gets 100 requests per 10 seconds and passes again once they left the window', () => {
        const limiter = createLimiter(0);

        for (let i = 0; i < 100; i++) assert.equal(limiter.check('a', 0), null);
        assert.equal(limiter.check('a', 9999), PER_CLIENT);
        assert.equal(limiter.check('b', 9999), null);
        assert.equal(limiter.check('a', 10_000), null);
    });

    test('refused requests count against their client', () => {
        const limiter = createLimiter(0);

        for (let i = 0; i < 100; i++) assert.equal(limiter.check('a', 0), null);
        for (let i = 0; i < 100; i++) assert.equal(limiter.check('a', 5000), PER_CLIENT);
        assert.equal(limiter.check('a', 10_000), PER_CLIENT);
        assert.equal(limiter.check('a', 15_000), null);
    });

    test('the 1001st request of a window is refused, until a request comes after the window end', () => {
        const limiter = createLimiter(0);

        for (let i = 0; i < 1000; i++) assert.equal(limiter.check(`client ${i}`, 0), null);
        assert.equal(limiter.check('late', 0), 'Global rate limit exceeded.');
        assert.equal(limiter.check('late', 10_000), 'Global rate limit exceeded.');
        assert.equal(limiter.check('late', 10_001), null);
    });

    test('two limiters keep their own counters', () => {
        const first = createLimiter(0);
        const second = createLimiter(0);

        for (let i = 0; i <= 100; i++) first.check('a', 0);
        assert.equal(first.check('a', 0), PER_CLIENT);
        assert.equal(second.check('a', 0), null);
    });

    test('a sweep drops the clients whose requests all left the window', () => {
        const limiter = createLimiter(0);

        limiter.check('a', 0);
        limiter.check('b', 5000);
        assert.equal(limiter.size, 2);

        limiter.check('c', 9999);
        assert.equal(limiter.size, 3);

        limiter.check('c', 10_000);
        assert.equal(limiter.size, 2);
    });
});
