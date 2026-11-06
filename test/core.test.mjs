import assert from 'assert/strict';
import fs from 'fs';
import { after, before, describe, mock, test } from 'node:test';
import { join } from 'path';

import { archiveEntries, archiveStream } from '../dist/lib/archive.js';
import { loadIndex } from '../dist/lib/packages.js';
import { route } from '../dist/lib/route.js';
import { exact } from '../dist/lib/stream.js';
import { scan } from '../dist/scan.js';

import { caseName, CASES, HEADERS, readBody } from './cases.mjs';
import { createFixture, SITE } from './fixture.mjs';
import { memoryPort } from './port.mjs';
import { rootDir } from './server.mjs';
import { collect } from './tar.mjs';

// SHA-256 of an empty file, the hash of every synthetic file
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// Names that a plain object treats apart (integer-like keys, the prototype setter, an inherited key), in byte order
const NAMES = ['10', '9', '__proto__', 'constructor'];

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
 * @returns False for a static file, OPTIONS and a locked case
 */
function isCoreCase({ method, locked, checkout }) {
    return !checkout && !locked && method !== 'OPTIONS';
}

/**
 * Produces the bytes that the adapter sends for a body of the core.
 *
 * @param response - Response from route(), whose Content-Length a file body must fill exactly
 * @param packagesDir - Packages folder that file paths and archive sources are relative to
 * @returns The JSON text, the file read from disk, nothing for an empty body, or the archive from the tar writer;
 * null when the archive stream errors, which the adapter turns into a reset
 */
async function sentBytes({ body, headers }, packagesDir) {
    if (body.kind === 'json') return Buffer.from(body.text);
    if (body.kind === 'empty') return Buffer.alloc(0);

    const port = memoryPort((path) => fs.readFileSync(join(packagesDir, path)));
    if (body.kind === 'file')
        return collect(exact(await port(body.path, body.range ?? undefined), Number(headers['Content-Length'])));

    try {
        return await collect(archiveStream(body.entries, port));
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
    const response = route(toRequest(entry), catalog, SITE);
    const { status } = response;
    const headers = Object.fromEntries(
        Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]),
    );

    // HEAD ends after the headers, so neither the file nor the archive is read
    const bytes = entry.method === 'HEAD' ? Buffer.alloc(0) : await sentBytes(response, fixture.packagesDir);
    if (bytes === null) return { status, headers, aborted: true };

    return { status, headers, body: readBody({ status, headers, body: bytes }) };
}

/**
 * Reads a snapshot entry of the route tests, reduced to what the core decides.
 *
 * @param key - Snapshot key, the suite and test names followed by the entry number
 * @returns Status, the recorded headers and the body or aborted; throws when the snapshot has no such entry
 */
function recorded(key) {
    assert.ok(snapshot.has(key), `the snapshot has no entry ${key}`);

    const { headers, ...rest } = snapshot.get(key);
    const owned = Object.entries(headers).filter(([name]) => HEADERS.includes(name));

    return { ...rest, headers: Object.fromEntries(owned) };
}

/**
 * Builds a file node of a synthetic index, empty and without the execute bit.
 *
 * @param name - File name
 * @returns The file node, hashed as an empty file
 */
function file(name) {
    return { kind: 'file', name, size: 0, exec: false, sha256: EMPTY_SHA256 };
}

/**
 * Builds a folder node of a synthetic index.
 *
 * @param name - Folder name
 * @param entries - Nodes of the folder in byte order
 * @returns The folder node
 */
function folder(name, entries) {
    return { kind: 'dir', name, entries };
}

/**
 * Builds a link node of a synthetic index.
 *
 * @param name - Link name
 * @param target - Raw target, as readlink gives it
 * @param real - Real target relative to the version folder, '' for the folder itself, left out when the link dangles,
 * loops or escapes
 * @returns The link node
 */
function link(name, target, real) {
    return real === undefined ? { kind: 'link', name, target } : { kind: 'link', name, target, real };
}

/**
 * Builds a version of a synthetic index, released on 2025-01-01.
 *
 * @param name - Version name, also the name of its root folder
 * @param entries - Nodes of the version folder in byte order
 * @returns The version node
 */
function version(name, entries) {
    return { name, date: '2025-01-01', root: folder(name, entries) };
}

/**
 * Builds the index of a synthetic tree of one type, npm, whose projects each have one version 1.0.0.
 *
 * @param projects - Pairs of a project name and the root entries of its version, in byte order
 * @param deprecated - Notice given to every project, none by default
 * @returns The index
 */
function indexOf(projects, deprecated) {
    const nodes = projects.map(([name, entries]) => ({
        name,
        ...(deprecated ? { deprecated } : {}),
        versions: [version('1.0.0', entries)],
    }));

    return { format: 2, types: [{ name: 'npm', projects: nodes }] };
}

/**
 * Loads the catalog of a synthetic tree of one type, npm, whose projects each have one version 1.0.0.
 *
 * @param projects - Pairs of a project name and the root entries of its version, in byte order
 * @param deprecated - Notice given to every project, none by default
 * @returns The catalog of the index
 */
function catalogOf(projects, deprecated) {
    return loadIndex(indexOf(projects, deprecated));
}

/**
 * Looks up a version of a catalog.
 *
 * @param from - Catalog to search
 * @param path - Version as type/project/version
 * @returns The catalog version, or undefined when a part of the path is missing
 */
function versionOf(from, path) {
    const [type, project, name] = path.split('/');

    return from.types.get(type)?.projects.get(project)?.versions.get(name);
}

/**
 * Sends a GET request to route().
 *
 * @param target - Request target, its query after the first '?'
 * @param from - Catalog to answer from
 * @returns Status, headers as the core set them, and the JSON body parsed, or the body itself when it is not JSON
 */
function get(target, from) {
    const { status, headers, body } = route(toRequest({ path: target }), from, SITE);

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

    test('a version that cannot be read is logged and left out, and so is the project that it leaves empty', () => {
        const base = fixture.packagesDir;
        const failed = (project, read) => [
            `Error reading ${join(base, 'npm', project, '1.0.0', read)}:`,
            `Skipping version ${join(base, 'npm', project, '1.0.0')}: it could not be read whole.`,
            `Skipping project ${join(base, 'npm', project)}: none of its versions could be indexed.`,
        ];

        assert.deepEqual(logged, [
            "Skipping type 'download': reserved name.",
            ...(fixture.locked ? failed('broken', 'locked.bin') : []),
            `Skipping ${join(base, 'npm', 'list')}: not a project name, expected letters, digits, '.', '_' and '-', not list.`,
            ...(fixture.locked ? failed('sealed', 'vault') : []),
        ]);
        for (const project of ['broken', 'sealed']) {
            assert.equal(catalog.types.get('npm').projects.has(project), !fixture.locked, project);
        }
    });

    test('a file with the owner execute bit is archived with mode 0755, any other file with 0644', () => {
        const entries = archiveEntries(versionOf(catalog, 'bash/gft/1.2.0'));

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
        assert.throws(() => loadIndex({ format: 1, types: [] }), /Unsupported packages index format: 1/);
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
        const etag = route(toRequest({ path }), catalog, SITE).headers.ETag;

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
    test('names 10, 9, __proto__ and constructor are served, JSON objects order them, lists keep byte order', () => {
        const root = NAMES.map((name) => file(name));
        const projects = NAMES.map((name) => ({ name, versions: [version('1.0.0', root)] }));
        const odd = loadIndex({ format: 2, types: NAMES.map((name) => ({ name, projects })) });

        // A JSON object lists integer-like keys first, whatever the order they were written in
        assert.deepEqual(Object.keys(get('/', odd).body.packages), ['9', '10', '__proto__', 'constructor']);
        assert.deepEqual(Object.keys(get('/download', odd).body.downloads), ['9', '10', '__proto__', 'constructor']);
        assert.equal(get('/__proto__', odd).body.message, '__proto__ projects.');
        assert.equal(get('/constructor', odd).status, 200);

        assert.deepEqual(Object.keys(get('/9', odd).body.projects), ['9', '10', 'list', '__proto__', 'constructor']);
        assert.equal(get('/9/__proto__', odd).status, 200);
        assert.equal(get('/9/constructor', odd).status, 200);

        assert.deepEqual(Object.keys(get('/9/10', odd).body.versions), ['latest', '1.0.0']);
        assert.equal(get('/9/10@latest', odd).body.current, '10@1.0.0');

        const listing = get('/9/10@1.0.0', odd).body.files.map(({ name }) => name);
        assert.deepEqual(listing, NAMES);
        const sums = get('/9/10@1.0.0?checksums', odd).body.checksums;
        assert.deepEqual(Object.keys(sums), ['9', '10', '__proto__', 'constructor']);
        assert.equal(get('/9/10@1.0.0/__proto__', odd).body.path, '9/10/1.0.0/__proto__');
        assert.equal(get('/9/10@1.0.0/constructor', odd).body.path, '9/10/1.0.0/constructor');

        // A list that is not a JSON object keeps the byte order of the index: name matches, then the projects of type 9
        assert.deepEqual(
            get('/search?q=9', odd).body.results.map(({ type, name }) => `${type}/${name}`),
            ['10/9', '9/9', '__proto__/9', 'constructor/9', '9/10', '9/__proto__', '9/constructor'],
        );
    });

    test('the ETag of a file is its quoted SHA-256, so equal sizes with other bytes give other tags', () => {
        const first = { ...file('a.js'), size: 4, sha256: 'a'.repeat(64) };
        const second = { ...file('b.js'), size: 4, sha256: 'b'.repeat(64) };
        const same = { ...file('c.js'), size: 9, sha256: 'a'.repeat(64) };
        const bytes = catalogOf([['p', [first, second, same]]]);

        assert.equal(get('/npm/p@1.0.0/a.js', bytes).headers.ETag, `"${'a'.repeat(64)}"`);
        assert.equal(get('/npm/p@1.0.0/b.js', bytes).headers.ETag, `"${'b'.repeat(64)}"`);
        assert.equal(get('/npm/p@1.0.0/c.js', bytes).headers.ETag, get('/npm/p@1.0.0/a.js', bytes).headers.ETag);
    });

    test('a link chain resolves to its file, a link to itself is never served nor listed', () => {
        const links = [link('first', 'second', 'file.js'), link('second', 'file.js', 'file.js'), link('self', 'self')];
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

    test('a path may cross 40 links: past them a file or a folder gives a plain 404, even with the tag', () => {
        const loops = catalogOf([['p', [folder('dist', [link('loop', '..', '')]), file('index.js')]]]);
        const loop = 'dist/loop/';

        assert.equal(get(`/npm/p@1.0.0/${loop.repeat(40)}index.js`, loops).status, 200);
        assert.equal(get(`/npm/p@1.0.0/${loop.repeat(40)}dist`, loops).status, 200);

        for (const target of [`${loop.repeat(41)}index.js`, `${loop.repeat(41)}dist`]) {
            const past = get(`/npm/p@1.0.0/${target}`, loops);

            assert.equal(past.status, 404, target);
            assert.deepEqual(Object.keys(past.headers), ['Content-Type', 'Content-Length'], target);
        }

        const tag = get(`/npm/p@1.0.0/${loop.repeat(40)}index.js`, loops).headers.ETag;
        const request = toRequest({
            path: `/npm/p@1.0.0/${loop.repeat(41)}index.js`,
            headers: { 'if-none-match': tag },
        });
        assert.equal(route(request, loops, SITE).status, 404);
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

    test('a folder shows its size whether it is reached through a link or not', () => {
        const key = { ...file('key.txt'), size: 7 };
        const tree = catalogOf([
            ['p', [link('door', 'vault', 'vault'), { ...file('index.js'), size: 3 }, folder('vault', [key])]],
        ]);

        assert.deepEqual(get('/npm/p@1.0.0', tree).body.files, [
            { name: 'door/', size: 7, directory: true },
            { name: 'index.js', size: 3, directory: false },
            { name: 'vault/', size: 7, directory: true },
        ]);
        assert.deepEqual(get('/npm/p@1.0.0/door', tree).body.files, [{ name: 'key.txt', size: 7, directory: false }]);
        assert.equal(get('/npm/p@1.0.0/door/key.txt', tree).status, 200);
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
            assert.deepEqual(Object.keys(headers), ['Content-Type', 'Content-Length'], target);
        }
    });

    test('a request URL that does not parse, or is not http or https, gives 400', () => {
        for (const url of ['not a url', 'data:text/plain,x', 'mailto:x', 'ftp://host/npm/lib', 'file:///npm/lib']) {
            const response = route({ method: 'GET', url, headers: new Headers() }, catalog, SITE);

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
