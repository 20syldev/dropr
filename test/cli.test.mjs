import assert from 'assert/strict';
import fs from 'fs';
import { after, before, describe, test } from 'node:test';
import os from 'os';
import { join } from 'path';

import { main } from '../dist/cli.js';

import { createFixture } from './fixture.mjs';
import { version } from './server.mjs';

describe('the command line', () => {
    let fixture;

    before(() => (fixture = createFixture()));
    after(() => fixture?.remove());

    /**
     * Runs the command line against a working folder, with its outputs recorded.
     *
     * @param argv - Arguments after the program name
     * @param change - Parts of the context that replace the default ones, a working folder of the fixture and no env
     * @returns The exit code, and the lines written to the output and to the error output
     */
    function run(argv, change = {}) {
        const out = [];
        const err = [];
        const code = main(argv, {
            env: {},
            cwd: fixture.root,
            out: (text) => out.push(text),
            err: (text) => err.push(text),
            ...change,
        });

        return { code, out, err };
    }

    /**
     * Writes a config file in a new folder, which is removed with remove().
     *
     * @param config - Content of dropr.config.json
     * @returns The folder, the file and remove(), which deletes exactly what was written, never recursively
     */
    function configFolder(config) {
        const root = fs.mkdtempSync(join(os.tmpdir(), 'dropr-cli-'));
        const file = join(root, 'dropr.config.json');
        fs.writeFileSync(file, JSON.stringify(config));

        return {
            root,
            file,
            remove: () => {
                fs.unlinkSync(file);
                fs.rmdirSync(root);
            },
        };
    }

    test('shows the usage for --help and -h, whatever the command', () => {
        for (const argv of [['--help'], ['-h'], ['check', '--help']]) {
            const { code, out, err } = run(argv);

            assert.equal(code, 0, argv.join(' '));
            assert.match(out[0], /^Usage: dropr <command> \[config\] \[options\]\n/);
            assert.deepEqual(err, []);
        }
    });

    test('shows the version of the package for --version and -v', () => {
        for (const flag of ['--version', '-v']) assert.deepEqual(run([flag]), { code: 0, out: [version], err: [] });
    });

    test('refuses a missing command, an unknown one, an unknown option and extra arguments with the usage and 2', () => {
        const cases = [
            [[], /^A command is needed\.\n\nUsage: /],
            [['build'], /^Unknown command 'build'\.\n\nUsage: /],
            [['serve', '--nope'], /--nope[\s\S]*\n\nUsage: /],
            [['serve', 'a.json', 'b.json'], /^Only one config file can be named\.\n\nUsage: /],
            [['check', '--port', '4000'], /^--port belongs to serve\.\n\nUsage: /],
        ];

        for (const [argv, message] of cases) {
            const { code, out, err } = run(argv);

            assert.equal(code, 2, argv.join(' '));
            assert.deepEqual(out, []);
            assert.match(err[0], message, argv.join(' '));
        }
    });

    test('refuses a port that is not an integer from 0 to 65535, from the option or from PORT, with 1', () => {
        const cases = [
            [['serve', '--port', 'abc'], {}, /^--port must be an integer from 0 to 65535, not 'abc'\.$/],
            [['serve', '--port', '70000'], {}, /^--port must be .* not '70000'\.$/],
            [['serve', '--port=-1'], {}, /^--port must be .* not '-1'\.$/],
            [['serve'], { PORT: 'junk' }, /^PORT must be an integer from 0 to 65535, not 'junk'\.$/],
        ];

        for (const [argv, env, message] of cases) {
            const { code, out, err } = run(argv, { env });

            assert.equal(code, 1, argv.join(' '));
            assert.deepEqual(out, []);
            assert.match(err[0], message);
        }
    });

    test('reports a config that is refused or missing with 1, nothing being started', () => {
        const missing = run(['check', join(fixture.root, 'nope.json')]);

        assert.equal(missing.code, 1);
        assert.match(missing.err[0], /^Invalid config: .*nope\.json cannot be read/);

        const refused = run(['check', join(fixture.root, '..', 'package.json')]);

        assert.equal(refused.code, 1);
        assert.match(refused.err[0], /^Invalid config: /);
    });

    test('checks the defaults when the working folder has no config, and counts what it finds', () => {
        const { code, out, err } = run(['check', '--packages', 'packages']);

        assert.equal(code, 0);
        assert.equal(out[0], 'Config: defaults, no dropr.config.json in the working folder');
        assert.equal(out[1], 'Name: dropr, port 4000');
        assert.equal(out[2], `Packages: 7 in ${join(fixture.root, 'packages')}`);
        assert.equal(out[3], 'Assets: 0 of 0');
        assert.match(out[4], /^\d+ problems reported above, whose entries a server skips\.$/);
        assert.ok(err.includes("Skipping type 'download': reserved name."), err.join('\n'));
        assert.ok(err.some((line) => line.startsWith('Skipping ') && line.endsWith('not list.')));
    });

    test('reads dropr.config.json of the working folder, its paths being relative to the file', () => {
        const folder = configFolder({
            name: 'folder',
            port: 5050,
            packagesDir: join(fixture.root, 'packages'),
            manifest: { baseUrl: 'https://cdn.example.com' },
            assets: { '/robots.txt': 'missing.txt' },
        });

        try {
            const { code, out, err } = run(['check'], { cwd: folder.root });

            assert.equal(code, 0);
            assert.equal(out[0], `Config: ${folder.file}`);
            assert.equal(out[1], 'Name: folder, port 5050');
            assert.equal(out[3], 'Assets: 0 of 1');
            assert.ok(
                err.some((line) => line.startsWith("Skipping asset '/robots.txt'")),
                err.join('\n'),
            );
        } finally {
            folder.remove();
        }
    });

    test('names the config file of the command, relative to the working folder, before the default one', () => {
        const folder = configFolder({
            name: 'named',
            packagesDir: join(fixture.root, 'packages'),
            manifest: { baseUrl: 'https://cdn.example.com' },
        });

        try {
            const { code, out } = run(['check', 'dropr.config.json'], { cwd: folder.root });

            assert.equal(code, 0);
            assert.equal(out[0], `Config: ${folder.file}`);
            assert.equal(out[1], 'Name: named, port 4000');
        } finally {
            folder.remove();
        }
    });

    test('lets --packages replace the packages folder of the config', () => {
        const folder = configFolder({ packagesDir: 'nowhere', manifest: { baseUrl: 'https://cdn.example.com' } });

        try {
            const broken = run(['check'], { cwd: folder.root });
            assert.equal(broken.code, 1);
            assert.equal(broken.err[0], `Packages folder ${join(folder.root, 'nowhere')} is not a folder.`);

            const fixed = run(['check', '--packages', join(fixture.root, 'packages')], { cwd: folder.root });
            assert.equal(fixed.code, 0);
            assert.equal(fixed.out[2], `Packages: 7 in ${join(fixture.root, 'packages')}`);
        } finally {
            folder.remove();
        }
    });

    test('fails the check of a packages folder that is not a folder, after naming the config', () => {
        const file = join(fixture.root, 'packages', 'npm', 'lib', '.versions.json');
        const { code, out, err } = run(['check', '--packages', file]);

        assert.equal(code, 1);
        assert.deepEqual(out, ['Config: defaults, no dropr.config.json in the working folder']);
        assert.deepEqual(err, [`Packages folder ${file} is not a folder.`]);
    });
});
