import assert from 'assert/strict';
import fs from 'fs';
import { after, before, describe, test } from 'node:test';
import os from 'os';
import { join } from 'path';

import { main } from '../dist/cli.js';
import { choosePort, configure } from '../dist/startup.js';

import { createFixture } from './fixture.mjs';
import { version } from './server.mjs';

/**
 * Runs the command line against a working folder, with its outputs recorded.
 *
 * @param argv - Arguments after the program name
 * @param cwd - Working folder of the command
 * @param env - Env of the command
 * @returns The exit code, and the lines written to the output and to the error output
 */
async function run(argv, cwd, env = {}) {
    const out = [];
    const err = [];
    const code = await main(argv, { env, cwd, out: (text) => out.push(text), err: (text) => err.push(text) });

    return { code, out, err };
}

/**
 * Makes a new folder with a dropr.config.json in it, or a link of that name.
 *
 * @param config - Content of the file; undefined to leave the folder without one
 * @param target - Target of a link to make instead of the file, which then points nowhere
 * @returns The folder, the path of the config file and remove(), which deletes exactly what was made, never recursively
 */
function configFolder(config, target = undefined) {
    const root = fs.mkdtempSync(join(os.tmpdir(), 'dropr-cli-'));
    const file = join(root, 'dropr.config.json');
    if (target !== undefined) fs.symlinkSync(target, file);
    else if (config !== undefined) fs.writeFileSync(file, JSON.stringify(config));

    return {
        root,
        file,
        remove: () => {
            if (fs.lstatSync(file, { throwIfNoEntry: false })) fs.unlinkSync(file);
            fs.rmdirSync(root);
        },
    };
}

describe('the command line', () => {
    let fixture;
    let packages;

    before(() => {
        fixture = createFixture();
        packages = join(fixture.root, 'packages');
    });
    after(() => fixture?.remove());

    test('shows the usage for --help and -h, whatever the command', async () => {
        for (const argv of [['--help'], ['-h'], ['check', '--help']]) {
            const { code, out, err } = await run(argv, fixture.root);

            assert.equal(code, 0, argv.join(' '));
            assert.match(out[0], /^Usage: dropr <command> \[config\] \[options\]\n/);
            assert.deepEqual(err, []);
        }
    });

    test('shows the version of the package for --version and -v', async () => {
        for (const flag of ['--version', '-v']) {
            assert.deepEqual(await run([flag], fixture.root), { code: 0, out: [version], err: [] });
        }
    });

    test('refuses a missing command, an unknown one, an unknown option and extra arguments with the usage and 2', async () => {
        const cases = [
            [[], /^A command is needed\.\n\nUsage: /],
            [['build'], /^Unknown command 'build'\.\n\nUsage: /],
            [['serve', '--nope'], /--nope[\s\S]*\n\nUsage: /],
            [['serve', 'a.json', 'b.json'], /^Only one config file can be named\.\n\nUsage: /],
            [['check', '--port', '4000'], /^--port belongs to serve\.\n\nUsage: /],
        ];

        for (const [argv, message] of cases) {
            const { code, out, err } = await run(argv, fixture.root);

            assert.equal(code, 2, argv.join(' '));
            assert.deepEqual(out, []);
            assert.match(err[0], message, argv.join(' '));
        }
    });

    test('refuses a port that is not an integer from 1 to 65535, from the option or from PORT, with 1', async () => {
        const cases = [
            [['serve', '--port', 'abc'], {}, /^--port must be an integer from 1 to 65535, not 'abc'\.$/],
            [['serve', '--port', '70000'], {}, /^--port must be .* not '70000'\.$/],
            [['serve', '--port', '0'], {}, /^--port must be .* not '0'\.$/],
            [['serve', '--port=-1'], {}, /^--port must be .* not '-1'\.$/],
            [['serve'], { PORT: 'junk' }, /^PORT must be an integer from 1 to 65535, not 'junk'\.$/],
            [['serve'], { PORT: '0' }, /^PORT must be .* not '0'\.$/],
        ];

        for (const [argv, env, message] of cases) {
            const { code, out, err } = await run(argv, fixture.root, env);

            assert.equal(code, 1, argv.join(' '));
            assert.deepEqual(out, []);
            assert.match(err[0], message);
        }
    });

    test('chooses the port of the option, then the one of PORT, and leaves the config alone otherwise', () => {
        assert.equal(choosePort('4001', '4002'), 4001);
        assert.equal(choosePort(undefined, '4002'), 4002);
        assert.equal(choosePort(undefined, ''), undefined);
        assert.equal(choosePort(undefined, undefined), undefined);
        assert.throws(() => choosePort('x', '4002'), /^Error: --port must be/);
    });

    test('puts the chosen port and packages folder over the ones of the config', () => {
        const folder = configFolder({ port: 5050, packagesDir: 'a', manifest: { baseUrl: 'https://cdn.example.com' } });

        try {
            const kept = configure(undefined, folder.root, undefined, undefined).config;
            assert.deepEqual([kept.port, kept.packagesDir], [5050, join(folder.root, 'a')]);

            const chosen = configure(undefined, folder.root, 'b', 4001).config;
            assert.deepEqual([chosen.port, chosen.packagesDir], [4001, join(folder.root, 'b')]);
        } finally {
            folder.remove();
        }
    });

    test('derives the base URL of the defaults from the chosen port', () => {
        const folder = configFolder();

        try {
            assert.equal(
                configure(undefined, folder.root, undefined, 4321).config.manifest.baseUrl,
                'http://localhost:4321',
            );
            assert.equal(
                configure(undefined, folder.root, undefined, undefined).config.manifest.baseUrl,
                'http://localhost:4000',
            );
        } finally {
            folder.remove();
        }
    });

    test('reports a config that is missing, not JSON or refused with 1, nothing being started', async () => {
        const missing = await run(['check', join(fixture.root, 'nope.json')], fixture.root);

        assert.equal(missing.code, 1);
        assert.match(missing.err[0], /^Invalid config: .*nope\.json cannot be read/);

        const folder = configFolder({ nope: 1 });
        try {
            const refused = await run(['check'], folder.root);
            assert.equal(refused.code, 1);
            assert.equal(refused.err[0], 'Invalid config: nope is not a known key');

            fs.writeFileSync(folder.file, '{');
            const broken = await run(['check'], folder.root);
            assert.equal(broken.code, 1);
            assert.match(broken.err[0], /^Invalid config: .* is not valid JSON/);
        } finally {
            folder.remove();
        }
    });

    test('reports a link to a config that is gone as a config that cannot be read, not as no config', async () => {
        const folder = configFolder(undefined, join(os.tmpdir(), 'dropr-cli-nowhere.json'));

        try {
            const { code, err } = await run(['check'], folder.root);

            assert.equal(code, 1);
            assert.match(err[0], /^Invalid config: .* cannot be read/);
        } finally {
            folder.remove();
        }
    });

    test('refuses an empty --packages, which would make the working folder the packages folder', async () => {
        const { code, err } = await run(['check', '--packages', ''], fixture.root);

        assert.equal(code, 1);
        assert.deepEqual(err, ['--packages must not be empty.']);
    });

    test('checks the defaults when the working folder has no config, and counts what it finds', async () => {
        const { code, out, err } = await run(['check', '--packages', 'packages'], fixture.root);

        assert.equal(code, 0);
        assert.equal(out[0], 'Config: defaults, no dropr.config.json in the working folder');
        assert.equal(out[1], 'Name: dropr, port 4000');
        assert.equal(out[2], `Packages: 7 in ${packages}`);
        assert.equal(out[3], 'Assets: 0 of 0');
        assert.match(out[4], /^\d+ problems reported above, whose entries a server skips\.$/);
        assert.ok(err.includes("Skipping type 'download': reserved name."), err.join('\n'));
        assert.ok(err.some((line) => line.startsWith('Skipping ') && line.endsWith('not list.')));
    });

    test('reads dropr.config.json of the working folder, its paths being relative to the file', async () => {
        const folder = configFolder({
            name: 'folder',
            port: 5050,
            packagesDir: packages,
            manifest: { baseUrl: 'https://cdn.example.com' },
            assets: { '/robots.txt': 'missing.txt' },
        });

        try {
            const { code, out, err } = await run(['check'], folder.root);

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

    test('names the config file of the command, relative to the working folder, before the default one', async () => {
        const config = { name: 'named', packagesDir: packages, manifest: { baseUrl: 'https://cdn.example.com' } };
        const folder = configFolder(config);

        try {
            const { code, out } = await run(['check', 'dropr.config.json'], folder.root);

            assert.equal(code, 0);
            assert.equal(out[0], `Config: ${folder.file}`);
            assert.equal(out[1], 'Name: named, port 4000');
        } finally {
            folder.remove();
        }
    });

    test('lets --packages replace the packages folder of the config', async () => {
        const folder = configFolder({ packagesDir: 'nowhere', manifest: { baseUrl: 'https://cdn.example.com' } });

        try {
            const broken = await run(['check'], folder.root);
            assert.equal(broken.code, 1);
            assert.equal(broken.err[0], `Packages folder ${join(folder.root, 'nowhere')} is not a folder.`);

            const fixed = await run(['check', '--packages', packages], folder.root);
            assert.equal(fixed.code, 0);
            assert.equal(fixed.out[2], `Packages: 7 in ${packages}`);
        } finally {
            folder.remove();
        }
    });

    test('fails the check of a packages folder that is not a folder, after naming the config', async () => {
        const file = join(packages, 'npm', 'lib', '.versions.json');
        const { code, out, err } = await run(['check', '--packages', file], fixture.root);

        assert.equal(code, 1);
        assert.deepEqual(out, ['Config: defaults, no dropr.config.json in the working folder']);
        assert.deepEqual(err, [`Packages folder ${file} is not a folder.`]);
    });

    test('fails the check of a packages folder that cannot be read', { skip: process.getuid?.() === 0 }, async () => {
        const folder = configFolder();
        const sealed = join(folder.root, 'sealed');
        fs.mkdirSync(sealed, { mode: 0o000 });

        try {
            const { code, err } = await run(['check', '--packages', sealed], folder.root);

            assert.equal(code, 1);
            assert.deepEqual(err, [`Packages folder ${sealed} cannot be read.`]);
        } finally {
            fs.rmdirSync(sealed);
            folder.remove();
        }
    });
});
