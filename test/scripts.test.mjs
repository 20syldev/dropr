import assert from 'assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import os from 'os';
import { join } from 'path';

import { parseDay } from '../dist/lib/dates.js';
import { isProjectName } from '../dist/lib/router.js';
import { isVersion as isIndexed } from '../dist/lib/semver.js';
import { isDay, isVersion } from '../scripts/versions.mjs';

import { ACCEPTED, NAME_ACCEPTED, NAME_REFUSED, REFUSED } from './names.mjs';
import { rootDir } from './server.mjs';

const SCRIPTS = join(rootDir, 'scripts');

let root;

/**
 * Writes an executable stand-in for a command that fetch.sh runs, so that no network is needed.
 *
 * @param name - Command name, found before the real one on the PATH of the script
 * @param lines - Body of the bash script
 */
function stub(name, lines) {
    fs.mkdirSync(join(root, 'bin'), { recursive: true });
    fs.writeFileSync(join(root, 'bin', name), ['#!/bin/bash', ...lines, ''].join('\n'), { mode: 0o755 });
}

/**
 * Runs fetch.sh from a copy of the scripts folder, so that its root folder is the temporary one.
 *
 * @param args - Arguments of fetch.sh, after --no-build
 * @param env - Extra environment: GFT_TAG is the tag that gft resolves, GFT_DATE the published_at it prints, GIT_FAIL
 * makes the clone fail
 * @returns Exit status and the output of both streams
 */
function fetch(args, env = {}) {
    const result = spawnSync('bash', [join(root, 'scripts', 'fetch.sh'), '--no-build', ...args], {
        env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, TMPDIR: join(root, 'tmp'), ...env },
        encoding: 'utf-8',
    });

    return { status: result.status, output: result.stdout + result.stderr };
}

/**
 * Lists every file below a folder, relative to it.
 *
 * @param dir - Folder to list, which may be missing
 * @returns Sorted paths, empty for a missing folder
 */
function files(dir) {
    if (!fs.existsSync(dir)) return [];

    return fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
        .sort();
}

beforeEach(() => {
    root = fs.mkdtempSync(join(os.tmpdir(), 'dropr-scripts-'));
    fs.mkdirSync(join(root, 'scripts'));
    fs.mkdirSync(join(root, 'tmp'));
    for (const name of ['fetch.sh', 'versions.mjs']) fs.copyFileSync(join(SCRIPTS, name), join(root, 'scripts', name));

    // gft prints the tag as -q, and a published_at as --json when GFT_DATE is set
    stub('gft', [
        'case " $* " in',
        '    *" -q "*) echo "${GFT_TAG:-v1.0.0}" ;;',
        '    *" --json "*) [ -z "${GFT_DATE:-}" ] || echo "{\\"published_at\\":\\"$GFT_DATE\\"}" ;;',
        'esac',
    ]);

    // git clone --depth 1 --branch <tag> <url> <dest> --quiet writes the tag it was asked for into the clone
    stub('git', [
        '[ -z "${GIT_FAIL:-}" ] || { echo "fatal: simulated network failure" >&2; exit 128; }',
        'while [ $# -gt 0 ]; do case "$1" in --branch) tag="$2" ;; esac; last2="$last1"; last1="$1"; shift; done',
        'mkdir -p "$last2" && echo "$tag" > "$last2/index.txt"',
    ]);
});

afterEach(() => {
    // Only what these tests write, and what fetch.sh leaves in its own temporary folder when its cleanup did not run
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else fs.unlinkSync(path);
        }
        fs.rmdirSync(dir);
    };
    walk(root);
});

describe('version names', () => {
    test('the server, versions.mjs and fetch.sh index the same names', () => {
        for (const name of ACCEPTED) {
            assert.equal(isIndexed(name), true, `server ${name}`);
            assert.equal(isVersion(name), true, `versions.mjs ${name}`);
        }
        for (const name of REFUSED) {
            assert.equal(isIndexed(name), false, `server ${JSON.stringify(name)}`);
            assert.equal(isVersion(name), false, `versions.mjs ${JSON.stringify(name)}`);
        }
    });

    test('fetch.sh refuses every name the server would skip, before it creates anything', () => {
        // A trailing newline never reaches the check, the command substitution of the script strips it
        for (const name of REFUSED.filter((name) => name !== '' && name !== 'v1.0.0' && name !== '1.0.0\n')) {
            const { status, output } = fetch(['a/demo', 'packages/bash'], { GFT_TAG: name });

            assert.equal(status, 1, JSON.stringify(name));
            assert.match(output, /is not an exact version/, JSON.stringify(name));
        }
        assert.deepEqual(files(join(root, 'packages')), []);
    });
});

describe('package names', () => {
    test('fetch.sh takes the names that the server indexes and no other, in any locale', () => {
        for (const name of NAME_ACCEPTED) assert.equal(isProjectName(name), true, name);
        for (const name of NAME_REFUSED) assert.equal(isProjectName(name), false, JSON.stringify(name));

        for (const name of NAME_REFUSED.filter((name) => name !== '' && !name.includes('\n'))) {
            const asProject = fetch(['a/demo', 'packages/bash', '', name], { LC_ALL: 'en_US.UTF-8' });

            assert.equal(asProject.status, 1, `project ${JSON.stringify(name)}`);
            assert.match(asProject.output, /is not a name the server indexes/, `project ${JSON.stringify(name)}`);

            // The type is the last segment of the path, so a slash cannot be part of it
            if (name.includes('/')) continue;

            const asType = fetch(['a/demo', `packages/${name}`], { LC_ALL: 'en_US.UTF-8' });

            assert.equal(asType.status, 1, `type ${JSON.stringify(name)}`);
            assert.match(asType.output, /is not a name the server indexes/, `type ${JSON.stringify(name)}`);
        }
        assert.equal(fs.existsSync(join(root, 'packages')), false);
    });
});

describe('release dates', () => {
    test('versions.mjs reads a day like the server does', () => {
        const days = [
            '2025-05-01',
            '2024-02-29',
            '1970-01-01',
            '2025-1-1',
            '2025-02-30',
            '0099-01-01',
            '1969-12-31',
            'x',
        ];
        for (const day of days) assert.equal(isDay(day), parseDay(day) !== null && parseDay(day) >= 0, day);

        const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
        assert.equal(isDay(new Date().toISOString().slice(0, 10)), true);
        assert.equal(isDay(tomorrow), false);
    });

    test('versions.mjs records a day, replaces it, and leaves the file alone when it refuses', () => {
        const file = join(root, 'p', '.versions.json');
        const run = (version, date) =>
            spawnSync(process.execPath, [join(root, 'scripts', 'versions.mjs'), file, version, date]);

        assert.equal(run('1.0.0', '2025-05-01').status, 0);
        assert.equal(run('1.0.0', '2025-05-02').status, 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), { '1.0.0': { date: '2025-05-02' } });

        const before = fs.readFileSync(file, 'utf-8');
        for (const [version, date] of [
            ['v1.0.0', '2025-05-01'],
            ['latest', '2025-05-01'],
            ['1.1.0', 'garbage'],
            ['1.1.0', '2999-01-01'],
        ]) {
            const refusal = run(version, date);

            assert.equal(refusal.status, 1, `${version} ${date}`);
            assert.match(String(refusal.stderr), /^versions\.mjs: /, `${version} ${date}`);
        }
        fs.writeFileSync(file, '{ "1.0.0": ');
        assert.equal(run('1.1.0', '2025-05-01').status, 1);
        assert.equal(fs.readFileSync(file, 'utf-8'), '{ "1.0.0": ');
        assert.ok(before.length > 0);
    });
});

describe('fetch.sh', () => {
    test('names the folder and the date key without the v of the tag, and clones the tag', (t) => {
        if (spawnSync('rsync', ['--version']).status !== 0) return t.skip('rsync is not installed');

        const { status, output } = fetch(['a/demo', 'packages/bash'], {
            GFT_TAG: 'v1.0.0',
            GFT_DATE: '2025-05-01T10:00:00Z',
        });

        assert.equal(status, 0, output);
        assert.deepEqual(files(join(root, 'packages')), ['bash/demo/.versions.json', 'bash/demo/1.0.0/index.txt']);
        assert.equal(fs.readFileSync(join(root, 'packages/bash/demo/1.0.0/index.txt'), 'utf-8'), 'v1.0.0\n');
        assert.deepEqual(JSON.parse(fs.readFileSync(join(root, 'packages/bash/demo/.versions.json'), 'utf-8')), {
            '1.0.0': { date: '2025-05-01' },
        });
    });

    test('falls back to the UTC day when the release has no date', (t) => {
        if (spawnSync('rsync', ['--version']).status !== 0) return t.skip('rsync is not installed');

        const before = new Date().toISOString().slice(0, 10);
        const { status, output } = fetch(['a/demo', 'packages/bash'], { GFT_TAG: '2.0.0', TZ: 'Pacific/Kiritimati' });
        const after = new Date().toISOString().slice(0, 10);

        assert.equal(status, 0, output);
        const { date } = JSON.parse(fs.readFileSync(join(root, 'packages/bash/demo/.versions.json'), 'utf-8'))['2.0.0'];
        assert.ok(date === before || date === after, `${date} is the UTC day (${before})`);
    });

    test('a date that is not a day stops it before any file or folder lands', () => {
        const { status, output } = fetch(['a/demo', 'packages/bash'], { GFT_TAG: '3.0.0', GFT_DATE: 'garbage' });

        assert.equal(status, 1, output);
        assert.deepEqual(files(join(root, 'packages')), []);
        assert.equal(fs.existsSync(join(root, 'packages', 'bash', 'demo')), false);
    });

    test('--force keeps the old version when the new one cannot be fetched', () => {
        const old = join(root, 'packages/bash/demo/1.0.0');
        fs.mkdirSync(old, { recursive: true });
        fs.writeFileSync(join(old, 'index.txt'), 'old\n');

        const { status } = fetch(['--force', 'a/demo', 'packages/bash'], {
            GFT_TAG: '1.0.0',
            GFT_DATE: '2025-05-01T10:00:00Z',
            GIT_FAIL: '1',
        });

        assert.notEqual(status, 0);
        assert.equal(fs.readFileSync(join(old, 'index.txt'), 'utf-8'), 'old\n');
    });
});
