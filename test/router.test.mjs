import assert from 'assert/strict';
import { describe, test } from 'node:test';

import { latestVersion, loadIndex, resolveVersion } from '../dist/lib/packages.js';
import { route } from '../dist/lib/route.js';
import { matchPath, RESERVED } from '../dist/lib/router.js';
import { ROUTES } from '../dist/manifest.js';
import { scan } from '../dist/scan.js';

import { createFixture } from './fixture.mjs';

// Seed of every random test, printed in the message of a failure so that it can be replayed
const SEED = 350;

// Match id that each route of the manifest has, the manifest and health routes being answered before the router
const MATCH_OF = {
    file: 'file',
    version: 'version',
    checksums: 'version',
    download: 'archive',
    downloads: 'typeDownloads',
    project: 'versions',
    changelog: 'changelog',
    type: 'type',
    search: 'search',
    index: 'root',
};

// Spellings of the '.' and '..' segments, a few names and some paths that stay encoded, 19 symbols for the walk
const SYMBOLS = [
    ...['.', '%2e', '%2E'],
    ...['..', '.%2e', '.%2E', '%2e.', '%2E.', '%2e%2e', '%2e%2E', '%2E%2e', '%2E%2E'],
    ...['x', 'lib@1', '%252e', '%2e%2e%2f', '%5c..', '%2e%00', '...'],
];

// Segments that the random targets draw from, most of them live in the fixture
const WORDS = [
    ...[
        'npm',
        'bash',
        'config',
        'lib',
        'lib@1.2.0',
        'lib@1',
        'lib@latest',
        'old',
        'old@1.0.0',
        'links@1.0.0',
        'gft@1.2.0',
    ],
    ...['index.js', 'dist', 'nested', 'deep.cjs', 'changelog', 'CHANGELOG', 'download', 'search', 'Search', 'health'],
    ...['', '.', '..', '%2e', '%2e%2e', '%2F', '%5C', '%00', '%0A', '%E0', '%', '@', 'lib@', '@1.0.0', 'x@y@z', 'NPM'],
    ...['folder', 'loop', 'inside', 'outside', 'dangling', 'file.js', 'a%2Fb', '%252e', '\\', 'a\\b', '#x', '?x'],
];

/**
 * Builds a seeded random generator, so that a failure of a random test can be replayed.
 *
 * @param seed - Integer that fixes the whole sequence
 * @returns A function that gives the next number from 0 included to 1 excluded
 */
function mulberry32(seed) {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Picks one item of a list.
 *
 * @param random - Seeded generator from mulberry32, advanced by one step
 * @param items - List to draw from, which must hold at least one item
 * @returns An item of the list, undefined when it is empty
 */
function pick(random, items) {
    return items[Math.floor(random() * items.length)];
}

/**
 * Lists every string that a match decoded from its path.
 *
 * @param match - Match from matchPath, whose type, name, version and path fields exist only for the ids that carry them
 * @returns The type, the name, the version and each segment of the file path, those the match has
 */
function decodedParts(match) {
    const { type, name, version, path } = match;

    return [type, name, version, ...(path === undefined ? [] : path.split('/'))].filter((part) => part !== undefined);
}

/**
 * Loads the catalog of the fixture without its unreadable projects, whose routes answer 500 by design.
 *
 * @param packagesDir - Folder of a generated fixture, which holds the unreadable sealed and broken projects
 * @returns The catalog, with no sealed and no broken project
 */
function readableCatalog(packagesDir) {
    const index = scan(packagesDir, { error: () => {} });

    for (const type of index.types) {
        type.projects = type.projects.filter(({ name }) => name !== 'sealed' && name !== 'broken');
    }

    return loadIndex(index);
}

/**
 * Tells whether a served file belongs to the project and the version that the target asked for.
 *
 * @param catalog - Catalog the target was routed on, whose latest and partial versions are resolved again here
 * @param target - Request target that was answered with a file, read through the same URL parsing as the request
 * @param served - Path of the file the core is about to send, relative to the packages folder
 * @returns True when its first three segments are the type, the project and the version that the target resolves to,
 * and no segment after them is '..'
 */
function servesAskedVersion(catalog, target, served) {
    const match = matchPath(new URL(`http://localhost${target}`).pathname);
    if (match.id !== 'file') return false;

    const project = catalog.packages[match.type]?.[match.name];
    const version = match.version === 'latest' ? latestVersion(project) : resolveVersion(match.version, project);
    const [type, name, resolved, ...rest] = served.split('/');

    return type === match.type && name === match.name && resolved === version && !rest.includes('..');
}

/**
 * Groups the parts that most rows of the table below share.
 *
 * @param type - Decoded type segment, which need not exist in the fixture
 * @param name - Decoded project name, cut before its last '@' when a version follows
 * @param version - Decoded version or partial version, null when the path names none
 * @returns The three fields of a match, to spread next to its id
 */
function row(type, name, version) {
    return { type, name, version };
}

describe('matchPath', () => {
    const ROWS = [
        ['/', { id: 'root' }],
        ['/search', { id: 'search' }],
        ['/search/', { id: 'unknown' }],
        ['/search/x', { id: 'unknown' }],
        ['/%73earch', { id: 'search' }],
        ['/Search', { id: 'type', type: 'Search' }],
        ['/download', { id: 'downloads' }],
        ['/download/', { id: 'downloads' }],
        ['/download/npm', { id: 'typeDownloads', type: 'npm' }],
        ['/download/npm/', { id: 'typeDownloads', type: 'npm' }],
        ['/%64ownload/npm', { id: 'typeDownloads', type: 'npm' }],
        ['/download/npm/lib', { id: 'archive', ...row('npm', 'lib', null) }],
        ['/download/npm/lib/', { id: 'unknown' }],
        ['/download/npm/lib@1.2', { id: 'archive', ...row('npm', 'lib', '1.2') }],
        ['/download/npm/lib@', { id: 'archive', ...row('npm', 'lib@', null) }],
        ['/download/npm/lib@@1', { id: 'archive', ...row('npm', 'lib@', '1') }],
        ['/download/npm/@1', { id: 'archive', ...row('npm', '@1', null) }],
        ['/download/npm/lib/x', { id: 'unknown' }],
        ['/download/a/b/c', { id: 'unknown' }],
        ['/Download/npm', { id: 'versions', type: 'Download', name: 'npm' }],
        ['/npm', { id: 'type', type: 'npm' }],
        ['/npm/', { id: 'type', type: 'npm' }],
        ['/NPM', { id: 'type', type: 'NPM' }],
        ['/n%70m', { id: 'type', type: 'npm' }],
        ['/npm/lib', { id: 'versions', type: 'npm', name: 'lib' }],
        ['/npm/lib/', { id: 'versions', type: 'npm', name: 'lib' }],
        ['/npm/caf%C3%A9', { id: 'versions', type: 'npm', name: 'caf\u00e9' }],
        ['/npm/lib@1', { id: 'version', ...row('npm', 'lib', '1') }],
        ['/npm/lib@1/', { id: 'version', ...row('npm', 'lib', '1') }],
        ['/npm/lib@', { id: 'versions', type: 'npm', name: 'lib@' }],
        ['/npm/@', { id: 'versions', type: 'npm', name: '@' }],
        ['/npm/@1.0.0', { id: 'versions', type: 'npm', name: '@1.0.0' }],
        ['/npm/%40moxon', { id: 'versions', type: 'npm', name: '@moxon' }],
        ['/npm/lib@@1.0.0', { id: 'version', ...row('npm', 'lib@', '1.0.0') }],
        ['/npm/lib@1.0.0@junk', { id: 'version', ...row('npm', 'lib@1.0.0', 'junk') }],
        ['/npm/a@b@c', { id: 'version', ...row('npm', 'a@b', 'c') }],
        ['/npm/lib/changelog', { id: 'changelog', type: 'npm', name: 'lib' }],
        ['/npm/lib/chang%65log', { id: 'changelog', type: 'npm', name: 'lib' }],
        ['/npm/lib/changelog/', { id: 'beneath', type: 'npm', name: 'lib' }],
        ['/npm/lib/CHANGELOG', { id: 'beneath', type: 'npm', name: 'lib' }],
        ['/npm/lib/changelog/x', { id: 'beneath', type: 'npm', name: 'lib' }],
        ['/npm/lib/x', { id: 'beneath', type: 'npm', name: 'lib' }],
        ['/npm/lib/x/y/z', { id: 'beneath', type: 'npm', name: 'lib' }],
        ['/npm/@moxon/api', { id: 'beneath', type: 'npm', name: '@moxon' }],
        ['/npm/lib@1/changelog', { id: 'file', ...row('npm', 'lib', '1'), path: 'changelog', slash: false }],
        ['/npm/lib@1/index.js', { id: 'file', ...row('npm', 'lib', '1'), path: 'index.js', slash: false }],
        ['/npm/lib@1/index.js/', { id: 'file', ...row('npm', 'lib', '1'), path: 'index.js', slash: true }],
        [
            '/npm/lib@1/dist/nested/deep.cjs',
            { id: 'file', ...row('npm', 'lib', '1'), path: 'dist/nested/deep.cjs', slash: false },
        ],
        ['/npm/lib@1/%C3%A9.js', { id: 'file', ...row('npm', 'lib', '1'), path: '\u00e9.js', slash: false }],
        ['/npm/lib@1/%252e', { id: 'file', ...row('npm', 'lib', '1'), path: '%2e', slash: false }],
        ['/npm/lib@1/dist%2Findex.mjs', { id: 'unknown' }],
        ['/npm/lib@1/dist%5Cindex.mjs', { id: 'unknown' }],
        ['/npm/lib@1/%2e%2e%2f', { id: 'unknown' }],
        ['/npm/lib@1/a%00b', { id: 'unknown' }],
        ['/npm/lib@1/a%0Ab', { id: 'unknown' }],
        ['/npm/lib@1/a%7Fb', { id: 'unknown' }],
        ['/npm/lib@1/a%C2%85b', { id: 'unknown' }],
        ['/npm/lib@1/%E0%A4%A', { id: 'encoding' }],
        ['/%E0', { id: 'encoding' }],
        ['/nope/%E0', { id: 'encoding' }],
        ['/%E0//', { id: 'encoding' }],
        ['//%E0', { id: 'encoding' }],
        ['/npm//%E0', { id: 'encoding' }],
        ['/%C2%85/%E0', { id: 'encoding' }],
        ['//', { id: 'unknown' }],
        ['//npm', { id: 'unknown' }],
        ['/npm//lib', { id: 'unknown' }],
        ['/npm/lib@1//', { id: 'unknown' }],
        ['/npm/lib@1/dist//', { id: 'unknown' }],
        ['/npm/lib@1//index.js', { id: 'unknown' }],
    ];

    for (const [pathname, expected] of ROWS) {
        test(pathname, () => assert.deepEqual(matchPath(pathname), expected));
    }

    test('every route of the manifest has its match, and the reserved names are its literal first segments', () => {
        const filled = { '{type}': 'npm', '{project}@{version}': 'lib@1', '{project}': 'lib', '{file}': 'index.js' };

        for (const { id, path } of ROUTES.filter(({ id }) => id !== 'manifest' && id !== 'health')) {
            const pathname = Object.entries(filled).reduce((acc, [token, value]) => acc.replace(token, value), path);

            assert.equal(matchPath(pathname.split('?')[0]).id, MATCH_OF[id], id);
        }

        const literals = ROUTES.map(({ path }) => path.split(/[/?]/)[1]).filter((word) => word && word[0] !== '{');

        assert.deepEqual([...new Set(literals)].sort(), [...RESERVED].sort());
    });

    test('a reserved path never matches a package type', () => {
        const targets = [
            '/download',
            '/download/x',
            '/download/x/y',
            '/download/x/y/z',
            '/search',
            '/search/',
            '/search/x',
        ];
        const typed = ['type', 'versions', 'version', 'changelog', 'file', 'beneath'];

        for (const target of targets) assert.ok(!typed.includes(matchPath(target).id), target);
    });

    test('is total on random strings, and every part it returns is whole and free of separators', () => {
        const random = mulberry32(SEED);
        const alphabet = ['a', '@', '/', '\\', '%', '2', 'F', 'e', '.', '0', '\n', '\u0085', '\ud83d\ude00', ' '];

        for (let i = 0; i < 20_000; i++) {
            const length = Math.floor(random() * 12);
            const pathname = `/${Array.from({ length }, () => pick(random, alphabet)).join('')}`;

            for (const part of decodedParts(matchPath(pathname))) {
                assert.ok(part !== '' && !/[\\/]|\p{Cc}/u.test(part), `seed ${SEED}: ${JSON.stringify(pathname)}`);
            }
        }
    });

    test('a name that went through encodeURIComponent comes back whole', () => {
        const random = mulberry32(SEED + 1);
        const alphabet = [
            'a',
            'b',
            '@',
            '%',
            ' ',
            '#',
            '?',
            '&',
            '+',
            '\u00e9',
            '\u4e2d',
            '\ud83d\ude00',
            '-',
            '_',
            '~',
        ];

        for (let i = 0; i < 5000; i++) {
            const name = Array.from({ length: 1 + Math.floor(random() * 8) }, () => pick(random, alphabet)).join('');
            const match = matchPath(`/npm/${encodeURIComponent(name)}`);
            const at = name.lastIndexOf('@');
            const split = at >= 1 && at < name.length - 1;
            const expected = split
                ? { id: 'version', type: 'npm', name: name.slice(0, at), version: name.slice(at + 1) }
                : { id: 'versions', type: 'npm', name };

            assert.deepEqual(match, expected, `seed ${SEED + 1}: ${JSON.stringify(name)}`);
        }
    });

    test('a trailing slash keeps the match of a listing and refuses search, archives and the changelog', () => {
        for (const path of ['/download', '/download/npm', '/npm', '/npm/lib', '/npm/lib@1']) {
            assert.deepEqual(matchPath(`${path}/`), matchPath(path), path);
        }
        for (const path of ['/search', '/download/npm/lib', '/npm/lib/changelog']) {
            assert.ok(!['unknown', 'beneath'].includes(matchPath(path).id), path);
            assert.ok(['unknown', 'beneath'].includes(matchPath(`${path}/`).id), path);
        }
        assert.equal(matchPath('//').id, 'unknown');
    });
});

describe('URL and router together', () => {
    test('no spelling of . or .. reaches a decoded part', () => {
        let count = 0;
        const walk = (prefix, depth) => {
            for (const symbol of SYMBOLS) {
                const url = `${prefix}/${symbol}`;
                const match = matchPath(new URL(url, 'http://localhost').pathname);
                count++;

                for (const part of decodedParts(match)) {
                    assert.ok(part !== '.' && part !== '..', `${url} gives the part ${part}`);
                }
                if (depth > 1) walk(url, depth - 1);
            }
        };

        walk('/npm', 4);
        assert.equal(count, 137_560);
    });

    test('a backslash reads as a slash, a fragment is cut and an encoded backslash stays one segment', () => {
        const pathname = (target) => new URL(`http://localhost${target}`).pathname;

        assert.equal(matchPath(pathname('/npm\\lib')).id, 'versions');
        assert.equal(matchPath(pathname('/npm/lib@1/dist\\index.mjs#x')).path, 'dist/index.mjs');
        assert.equal(matchPath(pathname('/npm/lib@1/dist%5Cindex.mjs')).id, 'unknown');
    });
});

describe('route() on random targets', () => {
    test('never throws, never answers 5xx and never serves a file outside its version', () => {
        const fixture = createFixture();

        try {
            const catalog = readableCatalog(fixture.packagesDir);
            const random = mulberry32(SEED + 2);
            const queries = ['', '?q=lib', '?q=a&q=b', '?checksums', '?download', '??q=lib', '?x=1', '?q='];
            const bad = [];

            for (let i = 0; i < 50_000; i++) {
                const length = 1 + Math.floor(random() * 6);
                const path = Array.from({ length }, () => pick(random, WORDS)).join('/');
                const target = `/${path}${pick(random, queries)}`;
                const method = random() < 0.05 ? 'HEAD' : 'GET';
                let response;
                try {
                    response = route({ method, url: `http://localhost${target}`, headers: new Headers() }, catalog);
                } catch (error) {
                    bad.push(`${target} throws ${error}`);
                    continue;
                }

                if (response.status >= 500) bad.push(`${target} answers ${response.status}`);
                if (response.body.kind === 'file' && !servesAskedVersion(catalog, target, response.body.path)) {
                    bad.push(`${target} serves ${response.body.path}`);
                }
            }

            assert.deepEqual(bad.slice(0, 5), [], `seed ${SEED + 2}`);
        } finally {
            fixture.remove();
        }
    });
});
