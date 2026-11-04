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
    test('a real YYYY-MM-DD day is kept, any other entry costs only the date of its version', () => {
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
            '2.0.0': { date: days(2) },
            '2.1.0': { date: '1969-12-31' },
            '3.0.0': { date: '2025-06-01' },
            '9.9.9': { date: '2025-01-01' },
        };
        const files = Object.fromEntries(Object.keys(entries).map((v) => [`npm/p/${v}/a.txt`, 'x']));
        write({ ...files, 'npm/p/.versions.json': JSON.stringify(entries) });

        const index = scanned();
        const dates = Object.fromEntries(versionsOf(index, 'p').map((entry) => entry.split('=')));
        const folder = new Date().toISOString().split('T')[0];

        assert.equal(dates['1.0.0'], '2025-05-01');
        assert.equal(dates['3.0.0'], '2025-06-01', 'an entry after a null one is still read');
        assert.equal(dates['1.9.0'], days(1), 'tomorrow is allowed, fetch.sh writes the date of its time zone');
        for (const v of ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0', '1.8.0', '2.0.0', '2.1.0']) {
            assert.equal(dates[v], folder, `${v} falls back to the day of its folder`);
        }

        const invalid = logged.filter((line) => line.startsWith('Invalid date of'));
        assert.deepEqual(
            invalid.map((line) => line.split(' ')[3]),
            ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0', '1.8.0', '2.0.0', '2.1.0'],
        );
        assert.equal(
            invalid[0],
            'Invalid date of 1.1.0 in <root>/npm/p/.versions.json: expected a YYYY-MM-DD day, not after tomorrow.',
        );
        assert.ok(
            logged.some((line) =>
                line.startsWith('No release date in <root>/npm/p/.versions.json for 1.1.0, 1.2.0, 1.3.0, ...,'),
            ),
        );
    });

    test('a file that is not an object of versions, or not JSON, gives no date and one line', () => {
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

        scanned();

        assert.deepEqual(
            logged.filter((line) => !line.startsWith('No release date')).map((line) => line.split(':')[0]),
            [
                'Invalid <root>/npm/a/.versions.json',
                'Error reading <root>/npm/b/.versions.json',
                'Invalid <root>/npm/c/.versions.json',
                'Error reading <root>/npm/d/.versions.json',
            ],
        );
    });

    test('a version without an entry takes the day of its folder, and the project logs it once', () => {
        write({
            'npm/p/1.0.0/a.txt': 'x',
            'npm/p/1.1.0/a.txt': 'x',
            'npm/p/.versions.json': '{ "1.0.0": { "date": "2025-01-01" } }',
        });
        fs.utimesSync(join(root, 'npm/p/1.1.0'), 1_700_000_000, 1_700_000_000);

        const index = scanned();

        assert.deepEqual(versionsOf(index, 'p'), ['1.0.0=2025-01-01', '1.1.0=2023-11-14']);
        assert.deepEqual(logged, [
            'No release date in <root>/npm/p/.versions.json for 1.1.0, using the date of the version folder.',
        ]);
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
    test('a folder named latest or holding an @ is logged and left out, so it never wins @latest', () => {
        const names = ['1.0.0', '1.0.0@beta', 'latest', '2.0.0-pre.1', 'abc', 'v3.0.0'];
        write(Object.fromEntries(names.map((v) => [`npm/p/${v}/a.txt`, v])));
        write({
            'npm/p/.versions.json': '{ "1.0.0": { "date": "2025-05-01" }, "2.0.0-pre.1": { "date": "2025-06-01" } }',
        });

        const index = scanned();

        assert.deepEqual(
            versionsOf(index, 'p').map((v) => v.split('=')[0]),
            ['abc', 'v3.0.0', '1.0.0', '2.0.0-pre.1'],
        );
        assert.deepEqual(
            logged.filter((line) => line.startsWith('Skipping')).sort(),
            ['1.0.0@beta', 'latest']
                .map((v) => `Skipping <root>/npm/p/${v}: a version is never named latest nor holds an '@'.`)
                .sort(),
        );
        assert.equal(get(index, '/npm/p@1.0.0@beta/a.txt').status, 404);
    });
});

describe('unreadable content', () => {
    test('a version with a locked file is left out whole, and @latest falls back to the release before', (t) => {
        write({ 'npm/p/1.0.0/a.txt': 'old', 'npm/p/2.0.0/a.txt': 'new', 'npm/p/2.0.0/locked.bin': 'x' });
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
        });
        fs.chmodSync(join(root, 'npm/q/1.0.0/vault'), 0);
        execFileSync('mkfifo', [join(root, 'npm/r/1.0.0/pipe')]);
        const locked = !isReadable(join(root, 'npm/q/1.0.0/vault'));

        const index = scanned();

        assert.deepEqual(versionsOf(index, 'p').length, 1);
        assert.equal(versionsOf(index, 'r').length, 0);
        assert.equal(versionsOf(index, 'q').length, locked ? 0 : 1);
        assert.ok(logged.includes('Skipping <root>/npm/r/1.0.0/pipe: not a file, a folder or a link.'));
        assert.ok(logged.includes('Skipping version <root>/npm/r/1.0.0: it could not be read whole.'));
        if (!locked) t.diagnostic('the folder stays readable, as it does for root');
    });

    test('a file larger than the read buffer is hashed like crypto does', () => {
        const bytes = crypto.randomBytes(3 * 1024 * 1024 + 17);
        write({ 'npm/p/1.0.0/big.bin': bytes, 'npm/p/1.0.0/empty.bin': '' });

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

        assert.equal(project.deprecated, null);
        assert.deepEqual(logged, [
            'Invalid deprecation notice in <root>/npm/x/.deprecated.json: expected a date, a message and a successor.',
        ]);
        assert.equal(get(index, '/npm/x').status, 200);
        assert.equal(get(index, '/npm/x@1.0.0/a.txt').status, 200);
    });
});
