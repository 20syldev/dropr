import assert from 'assert/strict';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import os from 'os';
import { join } from 'path';

import { loadIndex } from '../dist/lib/packages.js';
import { route } from '../dist/lib/route.js';
import { scan } from '../dist/scan.js';

import { isReadable } from './fixture.mjs';

let root;
let logged;

/**
 * Writes files into the temporary tree, creating their folders.
 *
 * @param files - Contents by path under the root
 */
function write(files) {
    for (const [path, content] of Object.entries(files)) {
        fs.mkdirSync(join(root, path, '..'), { recursive: true });
        fs.writeFileSync(join(root, path), content);
    }
}

/**
 * Builds the .versions.json of a project, giving each version the release day 2025-05-01.
 *
 * @param project - Project name under the npm type
 * @param versions - Names of the versions that have a date
 * @returns The file as contents by path, to give to write()
 */
function released(project, ...versions) {
    const dates = Object.fromEntries(versions.map((version) => [version, { date: '2025-05-01' }]));

    return { [`npm/${project}/.versions.json`]: JSON.stringify(dates) };
}

/**
 * Creates empty folders in the temporary tree, and their parents.
 *
 * @param paths - Folders to create under the root
 */
function folders(...paths) {
    for (const path of paths) fs.mkdirSync(join(root, path), { recursive: true });
}

/**
 * Creates symbolic links in the temporary tree, their folders being created when missing.
 *
 * @param links - Targets by path of the link under the root, each target as written in the link
 */
function link(links) {
    for (const [path, target] of Object.entries(links)) {
        fs.mkdirSync(join(root, path, '..'), { recursive: true });
        fs.symlinkSync(target, join(root, path));
    }
}

/**
 * Scans the temporary tree, recording what the scan logs with the root replaced by <root>.
 *
 * @returns The index
 */
function scanned() {
    logged = [];

    return scan(root, { error: (message) => logged.push(String(message).replaceAll(root, '<root>')) });
}

/**
 * Lists the versions of a project of the index.
 *
 * @param index - Index returned by scan
 * @param project - Project name under the npm type
 * @returns The version names in index order, with their dates as name=date
 */
function versionsOf(index, project) {
    const npm = index.types.find(({ name }) => name === 'npm');

    return npm.projects.find(({ name }) => name === project).versions.map(({ name, date }) => `${name}=${date}`);
}

/**
 * Asks the core for a path of the tree.
 *
 * @param index - Index returned by scan
 * @param target - Request target
 * @param headers - Request headers
 * @returns The response of route()
 */
function get(index, target, headers = {}) {
    return route({ method: 'GET', url: `http://localhost${target}`, headers: new Headers(headers) }, loadIndex(index));
}

beforeEach(() => {
    root = fs.mkdtempSync(join(os.tmpdir(), 'dropr-scan-'));
});

afterEach(() => {
    // Only what these tests write: a locked folder gets its mode back first, then the tree is emptied bottom up
    const walk = (dir) => {
        fs.chmodSync(dir, 0o755);
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else fs.unlinkSync(path);
        }
        fs.rmdirSync(dir);
    };
    walk(root);
});

describe('release dates', () => {
    test('a real YYYY-MM-DD day up to today is kept, any other entry costs the version', () => {
        const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString().split('T')[0];
        const entries = {
            '1.0.0': { date: '2025-05-01', repo: 'a/b' },
            '1.1.0': { date: '2025-02-30' },
            '1.2.0': { date: '2025-1-1' },
            '1.3.0': { date: 'garbage' },
            '1.4.0': null,
            '1.5.0': 'text',
            '1.6.0': {},
            '1.7.0': { date: 20250101 },
            '1.8.0': { date: '2999-01-01' },
            '1.9.0': { date: days(1) },
            '2.0.0': { date: days(0) },
            '2.1.0': { date: '1969-12-31' },
            '3.0.0': { date: '2025-06-01' },
            '9.9.9': { date: '2025-01-01' },
        };
        const files = Object.fromEntries([...Object.keys(entries), '4.0.0'].map((v) => [`npm/p/${v}/a.txt`, 'x']));
        write({ ...files, 'npm/p/.versions.json': JSON.stringify(entries) });

        const index = scanned();
        const dates = Object.fromEntries(versionsOf(index, 'p').map((entry) => entry.split('=')));

        assert.deepEqual(dates, {
            '1.0.0': '2025-05-01',
            '2.0.0': days(0),
            '3.0.0': '2025-06-01',
            '9.9.9': '2025-01-01',
        });

        const invalid = logged.filter((line) => line.startsWith('Invalid date of'));
        assert.deepEqual(
            invalid.map((line) => line.split(' ')[3]),
            ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0', '1.8.0', '1.9.0', '2.1.0'],
        );
        assert.equal(
            invalid[0],
            'Invalid date of 1.1.0 in <root>/npm/p/.versions.json: expected a YYYY-MM-DD day, not after today.',
        );
        assert.equal(
            logged.filter((line) => line.startsWith('Skipping version')).length,
            11,
            'each version without a date is left out and logged, the one without an entry (4.0.0) included',
        );
        assert.ok(
            logged.includes('Skipping version <root>/npm/p/4.0.0: no release date in <root>/npm/p/.versions.json.'),
        );
    });

    test('a file that is not an object of versions, or not JSON, gives no date and leaves its versions out', () => {
        write({
            'npm/a/1.0.0/a.txt': 'x',
            'npm/a/.versions.json': '[]',
            'npm/b/1.0.0/a.txt': 'x',
            'npm/b/.versions.json': '{ "1.0.0": ',
            'npm/c/1.0.0/a.txt': 'x',
            'npm/c/.versions.json': 'null',
            'npm/d/1.0.0/a.txt': 'x',
            'npm/d/.versions.json': '\ufeff{ "1.0.0": { "date": "2025-01-01" } }',
        });

        const index = scanned();

        assert.deepEqual(index.types, []);
        assert.deepEqual(
            logged.filter((line) => !line.startsWith('Skipping')).map((line) => line.split(':')[0]),
            [
                'Invalid <root>/npm/a/.versions.json',
                'Error reading <root>/npm/b/.versions.json',
                'Invalid <root>/npm/c/.versions.json',
                'Error reading <root>/npm/d/.versions.json',
            ],
        );
    });

    test('Last-Modified is the release day, on the 200 and on the 304', () => {
        write({ 'npm/p/1.0.0/a.txt': 'x', 'npm/p/.versions.json': '{ "1.0.0": { "date": "2025-05-01" } }' });

        const index = scanned();
        const sent = get(index, '/npm/p@1.0.0/a.txt');
        const tag = sent.headers.ETag;
        const same = get(index, '/npm/p@1.0.0/a.txt', { 'if-none-match': tag });

        assert.equal(sent.headers['Last-Modified'], 'Thu, 01 May 2025 00:00:00 GMT');
        assert.equal(same.status, 304);
        assert.equal(same.headers['Last-Modified'], 'Thu, 01 May 2025 00:00:00 GMT');
        assert.deepEqual(logged, []);
    });
});

describe('versions', () => {
    test('only X.Y.Z and X.Y.Z-tag name a version, whatever else is a folder is logged and left out', () => {
        const kept = ['1.0.0', '2.0.0-pre.1', '0.1.0-beta.10', '10.20.30', '1.0.0-0.3.7', '1.0.0-alpha-a.b-c'];
        const left = [
            '1.0.0@beta',
            'latest',
            'abc',
            'v3.0.0',
            '1.0',
            '1',
            '01.0.0',
            '1.0.00',
            '1.0.0-01',
            '1.0.0+build',
        ];
        write(Object.fromEntries([...kept, ...left].map((v) => [`npm/p/${v}/a.txt`, v])));
        write(released('p', ...kept));

        const index = scanned();

        assert.deepEqual(
            versionsOf(index, 'p').map((v) => v.split('=')[0]),
            ['0.1.0-beta.10', '1.0.0-0.3.7', '1.0.0-alpha-a.b-c', '1.0.0', '2.0.0-pre.1', '10.20.30'],
        );
        assert.deepEqual(
            logged.filter((line) => line.startsWith('Skipping')).sort(),
            left.map((v) => `Skipping <root>/npm/p/${v}: not a version name, expected X.Y.Z or X.Y.Z-tag.`).sort(),
        );
        assert.equal(get(index, '/npm/p@1.0.0@beta/a.txt').status, 404);
    });

    test('versions are in semver order and @latest is the newest release, not the last folder', () => {
        const names = ['1.10.0', '1.2.0', '1.9.0', '2.0.0-rc.2', '2.0.0-rc.10', '2.0.0-RC.1', '2.0.0-rc.1', '2.0.0'];
        write(Object.fromEntries(names.map((v) => [`npm/p/${v}/a.txt`, v])));
        write(released('p', ...names));

        const index = scanned();
        const listed = versionsOf(index, 'p').map((v) => v.split('=')[0]);

        assert.deepEqual(listed, [
            '1.2.0',
            '1.9.0',
            '1.10.0',
            '2.0.0-RC.1',
            '2.0.0-rc.1',
            '2.0.0-rc.2',
            '2.0.0-rc.10',
            '2.0.0',
        ]);
        assert.equal(JSON.parse(get(index, '/npm/p@latest').body.text).version, '2.0.0');
        assert.equal(JSON.parse(get(index, '/npm/p@1').body.text).version, '1.10.0');
    });

    test('a pre-release is the latest only while the project has no release', () => {
        write({
            'npm/p/1.0.0-beta.1/a.txt': 'x',
            'npm/p/1.0.0-beta.2/a.txt': 'x',
            ...released('p', '1.0.0-beta.1', '1.0.0-beta.2'),
        });

        const index = scanned();

        assert.equal(JSON.parse(get(index, '/npm/p@latest').body.text).version, '1.0.0-beta.2');
    });
});

describe('folders of the tree', () => {
    test('a hidden entry and a plain file are skipped without a word, a link or a FIFO is logged', () => {
        write({
            'npm/README.md': 'a file next to the projects',
            'npm/.cache/1.0.0/a.txt': 'x',
            'npm/p/.git/HEAD': 'x',
            'npm/p/NOTES.txt': 'x',
            'npm/p/1.0.0/a.txt': 'x',
            'npm/p/.versions.json': '{ "1.0.0": { "date": "2025-05-01" } }',
            'other/q/1.0.0/a.txt': 'x',
            'other/q/.versions.json': '{ "1.0.0": { "date": "2025-05-01" } }',
            '.hidden/q/1.0.0/a.txt': 'x',
        });
        link({ 'npm/r': 'p', 'npm/p/2.0.0': '1.0.0', linked: 'other' });
        execFileSync('mkfifo', [join(root, 'npm/pipe')]);

        const index = scanned();

        assert.deepEqual(
            index.types.map((type) => [type.name, type.projects.map((project) => project.name)]),
            [
                ['npm', ['p']],
                ['other', ['q']],
            ],
        );
        assert.deepEqual(
            logged.sort(),
            ['linked', 'npm/pipe', 'npm/p/2.0.0', 'npm/r']
                .map((path) => `Skipping <root>/${path}: not a folder, only folders are read at this level.`)
                .sort(),
        );
    });

    test('a project named list, or with other than letters, digits, dot, underscore and dash, is logged and left out', () => {
        const names = ['list', 'a@b', 'a\\b', 'a\nb', '@scoped', 'my pkg', 'q"x', 'caf\u00e9', '\u65e5\u672c', '-dash'];
        const ok = { 'npm/fine/.versions.json': '{ "1.0.0": { "date": "2025-05-01" } }', 'npm/fine/1.0.0/a.txt': 'x' };
        write(ok);
        for (const name of names) {
            write({ [`npm/${name}/1.0.0/a.txt`]: 'x', [`npm/${name}/.versions.json`]: ok['npm/fine/.versions.json'] });
        }

        const index = scanned();

        assert.deepEqual(
            index.types[0].projects.map((project) => project.name),
            ['fine'],
        );
        assert.deepEqual(
            logged.sort(),
            names
                .map(
                    (name) =>
                        `Skipping <root>/npm/${name}: not a project name, expected letters, digits, '.', '_' and '-', not list.`,
                )
                .sort(),
        );
    });

    test('a type is any folder with a plain name but the names of the routes, so src, lib and dist are types', () => {
        const files = { 'npm/p/1.0.0/a.txt': 'x', 'npm/p/.versions.json': '{ "1.0.0": { "date": "2025-05-01" } }' };
        for (const type of ['src', 'lib', 'dist', 'node_modules', 'download', 'Download', 'my type', 'caf\u00e9']) {
            write(Object.fromEntries(Object.entries(files).map(([path, text]) => [path.replace('npm', type), text])));
        }

        const index = scanned();

        assert.deepEqual(
            index.types.map((type) => type.name),
            ['Download', 'dist', 'lib', 'node_modules', 'src'],
        );
        assert.deepEqual(logged.sort(), [
            "Skipping type 'caf\u00e9': not a type name, expected letters, digits, '.', '_' and '-'.",
            "Skipping type 'download': reserved name.",
            "Skipping type 'my type': not a type name, expected letters, digits, '.', '_' and '-'.",
        ]);
    });

    test('a project without a version, or a type without a project, is logged and not indexed', () => {
        write({
            'npm/ok/1.0.0/a.txt': 'x',
            'npm/ok/.versions.json': '{ "1.0.0": { "date": "2025-05-01" } }',
            'npm/onlyfile/README.md': 'x',
            'npm/refused/v1.0.0/a.txt': 'x',
            'npm/refused/.versions.json': '{ "v1.0.0": { "date": "2025-05-01" } }',
            'npm/undated/1.0.0/a.txt': 'x',
            'bash/refused/latest/a.txt': 'x',
        });
        folders('npm/novers', 'config/novers');

        const index = scanned();

        assert.deepEqual(
            index.types.map((type) => [type.name, type.projects.map((project) => project.name)]),
            [['npm', ['ok']]],
        );
        assert.deepEqual(
            logged.filter((line) => /^Skipping (project|type)/.test(line)).sort(),
            [
                "Skipping type 'bash': none of its projects could be indexed.",
                "Skipping type 'config': none of its projects could be indexed.",
                'Skipping project <root>/bash/refused: none of its versions could be indexed.',
                'Skipping project <root>/config/novers: none of its versions could be indexed.',
                'Skipping project <root>/npm/novers: none of its versions could be indexed.',
                'Skipping project <root>/npm/onlyfile: none of its versions could be indexed.',
                'Skipping project <root>/npm/refused: none of its versions could be indexed.',
                'Skipping project <root>/npm/undated: none of its versions could be indexed.',
            ].sort(),
        );
        assert.equal(get(index, '/npm/refused@latest').status, 404);
        assert.equal(get(index, '/download/npm/novers').status, 404);
    });

    test('a name that no route can match, inside a version, leaves the whole version out', () => {
        write({
            'npm/p/1.0.0/a.txt': 'x',
            'npm/p/2.0.0/we\\ird.txt': 'x',
            'npm/p/3.0.0/tab\tbed/a.txt': 'x',
            'npm/p/.versions.json': JSON.stringify(
                Object.fromEntries(['1.0.0', '2.0.0', '3.0.0'].map((v) => [v, { date: '2025-05-01' }])),
            ),
        });

        const index = scanned();

        assert.deepEqual(
            versionsOf(index, 'p').map((v) => v.split('=')[0]),
            ['1.0.0'],
        );
        assert.deepEqual(logged.sort(), [
            'Skipping <root>/npm/p/2.0.0/we\\ird.txt: no route can match this name.',
            'Skipping <root>/npm/p/3.0.0/tab\tbed: no route can match this name.',
            'Skipping version <root>/npm/p/2.0.0: it could not be read whole.',
            'Skipping version <root>/npm/p/3.0.0: it could not be read whole.',
        ]);
    });

    test('every list is in UTF-8 byte order, whatever the platform lists, not in the order of a string compare', () => {
        const names = ['b', 'B', '\uff5e', '\u{1f600}', '\u00e9', 'a'];
        const tree = { 'npm/p/.versions.json': '{ "1.0.0": { "date": "2025-05-01" } }' };
        for (const name of names) tree[`npm/p/1.0.0/${name}`] = name;
        write(tree);

        const index = scanned();
        const listed = index.types[0].projects[0].versions[0].root.entries.map(({ name }) => name);

        assert.deepEqual(
            listed,
            [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
        );
        assert.deepEqual(listed, ['B', 'a', 'b', '\u00e9', '\uff5e', '\u{1f600}']);
        assert.ok([...names].sort()[5] === '\uff5e', 'a plain sort() would put U+1F600 before U+FF5E');
    });
});

describe('unreadable content', () => {
    test('a version with a locked file is left out whole, and @latest falls back to the release before', (t) => {
        write({
            'npm/p/1.0.0/a.txt': 'old',
            'npm/p/2.0.0/a.txt': 'new',
            'npm/p/2.0.0/locked.bin': 'x',
            ...released('p', '1.0.0', '2.0.0'),
        });
        fs.chmodSync(join(root, 'npm/p/2.0.0/locked.bin'), 0);
        if (isReadable(join(root, 'npm/p/2.0.0/locked.bin')))
            return t.skip('the file stays readable, as it does for root');

        const index = scanned();

        assert.deepEqual(
            versionsOf(index, 'p').map((v) => v.split('=')[0]),
            ['1.0.0'],
        );
        assert.equal(logged[0].split(':')[0], 'Error reading <root>/npm/p/2.0.0/locked.bin');
        assert.ok(logged.includes('Skipping version <root>/npm/p/2.0.0: it could not be read whole.'));
        assert.equal(JSON.parse(get(index, '/npm/p@latest').body.text).version, '1.0.0');
        assert.equal(get(index, '/npm/p@2.0.0/a.txt').status, 404);
    });

    test('a folder that cannot be listed, or a FIFO, leaves its version out as well', (t) => {
        write({
            'npm/p/1.0.0/a.txt': 'x',
            'npm/q/1.0.0/a.txt': 'x',
            'npm/q/1.0.0/vault/k.txt': 'x',
            'npm/r/1.0.0/a.txt': 'x',
            'npm/s/1.0.0/a.txt': 'x',
            ...released('p', '1.0.0'),
            ...released('q', '1.0.0'),
            ...released('r', '1.0.0'),
            ...released('s', '1.0.0'),
        });
        fs.chmodSync(join(root, 'npm/q/1.0.0/vault'), 0);
        execFileSync('mkfifo', [join(root, 'npm/r/1.0.0/pipe')]);
        const locked = !isReadable(join(root, 'npm/q/1.0.0/vault'));

        const index = scanned();
        const projects = index.types[0].projects.map(({ name }) => name);

        assert.deepEqual(projects, locked ? ['p', 's'] : ['p', 'q', 's']);
        assert.ok(logged.includes('Skipping <root>/npm/r/1.0.0/pipe: not a file, a folder or a link.'));
        assert.ok(logged.includes('Skipping version <root>/npm/r/1.0.0: it could not be read whole.'));
        if (!locked) t.diagnostic('the folder stays readable, as it does for root');
    });

    test('a file larger than the read buffer is hashed like crypto does', () => {
        const bytes = crypto.randomBytes(3 * 1024 * 1024 + 17);
        write({ 'npm/p/1.0.0/big.bin': bytes, 'npm/p/1.0.0/empty.bin': '', ...released('p', '1.0.0') });

        const index = scanned();
        const files = index.types[0].projects[0].versions[0].root.entries;

        assert.equal(
            files.find(({ name }) => name === 'big.bin').sha256,
            crypto.createHash('sha256').update(bytes).digest('hex'),
        );
        assert.equal(
            files.find(({ name }) => name === 'empty.bin').sha256,
            crypto.createHash('sha256').update('').digest('hex'),
        );
    });
});

describe('deprecation notice', () => {
    test('a successor that cannot go in a header is refused and logged, so the project keeps answering', () => {
        write({
            'npm/x/1.0.0/a.txt': 'x',
            'npm/x/.versions.json': '{ "1.0.0": { "date": "2025-01-01" } }',
            'npm/x/.deprecated.json': JSON.stringify({
                date: '2025-06-01',
                message: 'm',
                successor: '/npm/y\r\nSet-Cookie: a=b',
            }),
        });

        const index = scanned();
        const project = index.types[0].projects[0];

        assert.equal('deprecated' in project, false);
        assert.deepEqual(logged, [
            'Invalid deprecation notice in <root>/npm/x/.deprecated.json: expected a YYYY-MM-DD date, a message and a successor.',
        ]);
        assert.equal(get(index, '/npm/x').status, 200);
        assert.equal(get(index, '/npm/x@1.0.0/a.txt').status, 200);
    });
});
