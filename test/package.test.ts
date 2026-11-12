import assert from 'assert/strict';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { describe, test } from 'node:test';
import { join } from 'path';

import { rootDir } from './server.ts';

interface Manifest {
    name: string;
    main: string;
    types: string;
    bin: Record<string, string>;
    exports: Record<string, Record<string, string>>;
    publishConfig: { access: string };
    engines: { node: string };
    dependencies: Record<string, string>;
}

// A file listed by npm pack
interface PackedFile {
    path: string;
}

const manifest = JSON.parse(fs.readFileSync(join(rootDir, 'package.json'), 'utf-8')) as Manifest;

// Exports of the package, which the command line and the README promise
const API = [
    'buildManifest',
    'createApp',
    'createHandler',
    'createReader',
    'createResponder',
    'loadConfig',
    'loadIndex',
    'parseConfig',
    'scan',
    'scanAssets',
];

// Exports of the entry that needs no Node, all of them also exported by the main entry
const CORE = ['buildManifest', 'createHandler', 'createResponder', 'loadIndex', 'parseConfig'];

/**
 * Lists what npm would put in the tarball, without building nor writing anything.
 *
 * @returns The paths of the files of the tarball, relative to the package root
 */
function packed(): string[] {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });

    return (JSON.parse(output) as { files: PackedFile[] }[])[0].files.map(({ path }) => path);
}

describe('the package', () => {
    const files = packed();

    test('ships the build, the readme, the licence and the manifest, and nothing else', () => {
        for (const path of files) {
            assert.ok(
                ['LICENSE', 'README.md', 'package.json'].includes(path) ||
                    (path.startsWith('dist/') && !path.endsWith('.map')),
                path,
            );
        }
        for (const path of [
            'LICENSE',
            'README.md',
            'package.json',
            'dist/bin.js',
            'dist/index.js',
            'dist/index.d.ts',
            'dist/core.js',
            'dist/core.d.ts',
        ]) {
            assert.ok(files.includes(path), `${path} is not in the tarball`);
        }
    });

    test('leaves the packages, the tests, the sources and the config of the repository out', () => {
        for (const path of ['packages', 'test', 'src', 'scripts', 'public', 'dropr.config.json', 'robots.txt']) {
            assert.deepEqual(
                files.filter((file) => file === path || file.startsWith(`${path}/`)),
                [],
                path,
            );
        }
    });

    test('points its entries at files of the tarball, the command starting with a shebang', () => {
        const targets = [
            manifest.main,
            manifest.types,
            manifest.bin.dropr,
            ...Object.values(manifest.exports['.']),
            ...Object.values(manifest.exports['./core']),
        ];

        for (const target of targets) assert.ok(files.includes(target.replace(/^\.\//, '')), target);
        assert.ok(fs.readFileSync(join(rootDir, 'dist', 'bin.js'), 'utf-8').startsWith('#!/usr/bin/env node\n'));
    });

    test('holds no build output whose source is gone', () => {
        const orphans = files.filter((path) => {
            const source = path.replace(/^dist\//, 'src/').replace(/\.(d\.ts|js)$/, '.ts');

            return path.startsWith('dist/') && !fs.existsSync(join(rootDir, source));
        });

        assert.deepEqual(orphans, []);
    });

    test('exports the API and nothing else', async () => {
        const entry = await import('../dist/index.js');

        assert.deepEqual(Object.keys(entry).sort(), API);
    });

    test('exports the core entry, which is the same code as the main entry gives', async () => {
        const core = await import('../dist/core.js');
        const main = await import('../dist/index.js');

        assert.deepEqual(Object.keys(core).sort(), CORE);
        for (const name of CORE)
            assert.equal((core as Record<string, unknown>)[name], (main as Record<string, unknown>)[name], name);
    });

    test('builds a fetch handler from its exports alone', async () => {
        const { buildManifest, createHandler, createReader, loadIndex, parseConfig, scan } =
            await import('../dist/index.js');
        const config = parseConfig({ manifest: { baseUrl: 'http://localhost' } });
        const packagesDir = join(rootDir, 'no-packages');
        const logger = { error() {} };
        const handler = createHandler({
            catalog: loadIndex(scan(packagesDir, logger)),
            name: config.name,
            version: '1.0.0',
            manifest: buildManifest(config.manifest, config.name, '1.0.0'),
            read: createReader(packagesDir),
            assets: {},
            clientHeader: null,
            rateLimit: config.rateLimit,
            logger,
        });
        const response = await handler(new Request('http://localhost/health'), '127.0.0.1');

        assert.equal(response.status, 200);
        assert.equal((await response.json()).status, 'ok');
    });

    test('is named dropr, public, and asks for the Node it is tested on', () => {
        assert.equal(manifest.name, 'dropr');
        assert.equal(manifest.publishConfig.access, 'public');
        assert.equal(manifest.engines.node, '>=24');
    });

    test('depends on registry ranges only, which a published package needs', () => {
        for (const [name, range] of Object.entries(manifest.dependencies)) {
            assert.match(range, /^[\^~]?\d/, `${name}: ${range}`);
        }
    });
});
