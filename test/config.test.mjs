import assert from 'assert/strict';
import fs from 'fs';
import { describe, test } from 'node:test';
import os from 'os';
import { join } from 'path';

import { loadConfig } from '../dist/config.js';
import { parseConfig } from '../dist/lib/config.js';
import { buildManifest } from '../dist/manifest.js';

import { config, rootDir } from './server.mjs';

const MINIMAL = { manifest: { baseUrl: 'https://cdn.example.com' } };

// Configs that parseConfig refuses, each with the key its message must name
const INVALID = [
    ['the file', [], 'the file'],
    ['name', { ...MINIMAL, name: '' }, 'name'],
    ['port', { ...MINIMAL, port: 1.5 }, 'port'],
    ['port', { ...MINIMAL, port: 70000 }, 'port'],
    ['port', { ...MINIMAL, port: '4000' }, 'port'],
    ['packagesDir', { ...MINIMAL, packagesDir: '' }, 'packagesDir'],
    ['clientIp.header', { ...MINIMAL, clientIp: { header: 'x client' } }, 'clientIp.header'],
    ['clientIp.trustProxy', { ...MINIMAL, clientIp: { trustProxy: 'yes' } }, 'clientIp.trustProxy'],
    ['clientIp.proxy', { ...MINIMAL, clientIp: { proxy: true } }, 'clientIp.proxy'],
    ['manifest.baseUrl', {}, 'manifest.baseUrl'],
    ['manifest.baseUrl', { manifest: {} }, 'manifest.baseUrl'],
    ['manifest.baseUrl', { manifest: { baseUrl: 'cdn.example.com' } }, 'manifest.baseUrl'],
    ['manifest.baseUrl', { manifest: { baseUrl: 'ftp://cdn.example.com' } }, 'manifest.baseUrl'],
    ['manifest.baseUrl', { manifest: { baseUrl: 'https://cdn.example.com/' } }, 'manifest.baseUrl'],
    ['manifest.baseUrl', { manifest: { baseUrl: 'https://cdn.example.com\n' } }, 'manifest.baseUrl'],
    ['manifest.baseUrl', { manifest: { baseUrl: 'https://cdn.example.com/a b' } }, 'manifest.baseUrl'],
    ['manifest.params.nope', { manifest: { ...MINIMAL.manifest, params: { nope: {} } } }, 'manifest.params.nope'],
    [
        'manifest.params.q.name',
        { manifest: { ...MINIMAL.manifest, params: { q: { name: 'term' } } } },
        'manifest.params.q.name',
    ],
    [
        'manifest.params.project.name',
        { manifest: { ...MINIMAL.manifest, params: { project: { name: 'type' } } } },
        'manifest.params',
    ],
    [
        'manifest.params.file.name',
        { manifest: { ...MINIMAL.manifest, params: { file: { name: 'a b' } } } },
        'file.name',
    ],
    ['manifest.params.type.title', { manifest: { ...MINIMAL.manifest, params: { type: { title: 'x' } } } }, 'title'],
    ['manifest.routes.nope', { manifest: { ...MINIMAL.manifest, routes: { nope: {} } } }, 'manifest.routes.nope'],
    ['manifest.routes.file.title', { manifest: { ...MINIMAL.manifest, routes: { file: { title: 3 } } } }, 'title'],
    [
        'manifest.routes.file.notes',
        { manifest: { ...MINIMAL.manifest, routes: { file: { notes: ['a', 2] } } } },
        'notes',
    ],
    ['assets', { ...MINIMAL, assets: { 'favicon.ico': 'favicon.ico' } }, 'assets.favicon.ico'],
    ['assets', { ...MINIMAL, assets: { '/favicon.ico': 3 } }, 'assets./favicon.ico'],
    ['unknown key', { ...MINIMAL, nmae: 'x' }, 'nmae'],
];

describe('parseConfig', () => {
    test('a config with only a base URL gets the defaults, which stay neutral', () => {
        assert.deepEqual(parseConfig(MINIMAL), {
            name: 'dropr',
            port: 4000,
            packagesDir: 'packages',
            clientIp: { header: null, trustProxy: false },
            manifest: { baseUrl: 'https://cdn.example.com', params: {}, routes: {} },
            assets: {},
        });
    });

    test('manifest overrides are kept as written, the English defaults being merged in by buildManifest', () => {
        const manifest = {
            baseUrl: 'https://cdn.example.com',
            params: { type: { description: 'Kind.' } },
            routes: { file: { title: 'Download', notes: [] } },
        };

        assert.deepEqual(parseConfig({ manifest }).manifest, manifest);
    });

    test('a header name is lowercased and the input is left as it was', () => {
        const input = { ...MINIMAL, clientIp: { header: 'X-Real-IP', trustProxy: true } };
        const copy = structuredClone(input);

        assert.deepEqual(parseConfig(input).clientIp, { header: 'x-real-ip', trustProxy: true });
        assert.deepEqual(input, copy);
    });

    test('a resolved config parses again to itself', () => {
        for (const input of [MINIMAL, structuredClone(config)]) {
            assert.deepEqual(parseConfig(parseConfig(input)), parseConfig(input));
        }
    });

    for (const [label, input, key] of INVALID) {
        test(`refuses ${label}`, () => {
            assert.throws(
                () => parseConfig(input),
                (error) => error.message.startsWith('Invalid config: ') && error.message.includes(key),
            );
        });
    }
});

describe('buildManifest', () => {
    const build = (manifest = MINIMAL.manifest) => buildManifest(parseConfig({ manifest }).manifest, 'dropr', '1.0.0');
    const find = (manifest, id) => manifest.routes.find((route) => route.id === id);

    test('the defaults are English, in reading order, and carry the placeholder names of the paths', () => {
        const manifest = build();

        assert.deepEqual(
            [manifest.name, manifest.version, manifest.baseUrl],
            ['dropr', '1.0.0', 'https://cdn.example.com'],
        );
        assert.deepEqual(
            manifest.routes.map(({ id, title, path }) => [id, title, path]),
            [
                ['file', 'File', '/{type}/{project}@{version}/{file}'],
                ['version', 'Version', '/{type}/{project}@{version}'],
                ['checksums', 'Checksums', '/{type}/{project}@{version}?checksums'],
                ['download', 'Archive', '/download/{type}/{project}@{version}'],
                ['downloads', 'Available archives', '/download/{type}'],
                ['project', 'Project', '/{type}/{project}'],
                ['changelog', 'Changelog', '/{type}/{project}/changelog'],
                ['type', 'Type', '/{type}'],
                ['search', 'Search', '/search'],
                ['index', 'Index', '/'],
                ['manifest', 'Manifest', '/manifest'],
                ['health', 'Health', '/health'],
            ],
        );
    });

    test('every route has a summary, an example and its params with a description and an example', () => {
        for (const route of build().routes) {
            assert.ok(route.summary.endsWith('.'), route.id);
            assert.ok(route.example.startsWith('/'), route.id);
            for (const param of route.params)
                assert.ok(param.description && param.example, `${route.id} ${param.name}`);
        }
    });

    test('the defaults pin a route with shared params and notes in full', () => {
        assert.deepEqual(find(build(), 'download'), {
            id: 'download',
            group: 'downloads',
            method: 'GET',
            path: '/download/{type}/{project}@{version}',
            title: 'Archive',
            summary: 'Downloads a whole version as a .tar.gz, as an attachment.',
            params: [
                {
                    name: 'type',
                    in: 'path',
                    required: true,
                    description: 'Package type: npm, bash or config.',
                    example: 'npm',
                },
                {
                    name: 'project',
                    in: 'path',
                    required: true,
                    description: 'Name of the project in this type.',
                    example: 'moxon',
                },
                {
                    name: 'version',
                    in: 'path',
                    required: false,
                    description: 'Exact version (6.1.0), partial (6 or 6.1) or latest.',
                    example: '6.1.0',
                },
            ],
            example: '/download/bash/gft@1.0.6',
            returns: 'archive',
            notes: [
                'Without a version, serves the `latest` version.',
                'Same as `/{type}/{project}@{version}?download`.',
            ],
        });
        assert.deepEqual(find(build(), 'search').params, [
            {
                name: 'q',
                in: 'query',
                required: true,
                description: 'Text searched in the names, or an exact type.',
                example: 'mox',
            },
        ]);
    });

    test('the defaults hold only printable ASCII', () => {
        assert.match(JSON.stringify(build()), /^[\x20-\x7e]*$/);
    });

    test('a partial override of a route keeps its other fields and leaves the other routes alone', () => {
        const base = build();
        const manifest = build({ ...MINIMAL.manifest, routes: { health: { title: 'Status' } } });

        assert.deepEqual(find(manifest, 'health'), { ...find(base, 'health'), title: 'Status' });
        assert.deepEqual(
            manifest.routes.filter(({ id }) => id !== 'health'),
            base.routes.filter(({ id }) => id !== 'health'),
        );
    });

    test('an override of the notes replaces them, even with an empty list', () => {
        const manifest = build({ ...MINIMAL.manifest, routes: { file: { notes: [] }, version: { notes: ['Own.'] } } });

        assert.deepEqual([find(manifest, 'file').notes, find(manifest, 'version').notes], [[], ['Own.']]);
    });

    test('a partial override of a param keeps its other fields in every route that uses it', () => {
        const base = build();
        const manifest = build({ ...MINIMAL.manifest, params: { type: { example: 'bash' } } });

        for (const route of manifest.routes) {
            const before = find(base, route.id);
            route.params.forEach((param, i) => {
                const expected = param.name === 'type' ? { ...before.params[i], example: 'bash' } : before.params[i];
                assert.deepEqual(param, expected);
            });
        }
    });

    test('a renamed path param is renamed in the paths and in the notes, not in the examples', () => {
        const manifest = build({ ...MINIMAL.manifest, params: { project: { name: 'name' }, file: { name: 'path' } } });

        assert.equal(find(manifest, 'file').path, '/{type}/{name}@{version}/{path}');
        assert.equal(find(manifest, 'download').notes[1], 'Same as `/{type}/{name}@{version}?download`.');
        assert.equal(find(manifest, 'file').example, '/npm/moxon@6.1.0/package.json');
        assert.deepEqual(
            find(manifest, 'file').params.map((param) => param.name),
            ['type', 'name', 'version', 'path'],
        );
    });

    test('a renamed path param is renamed in the notes of the config too', () => {
        const manifest = build({
            ...MINIMAL.manifest,
            params: { type: { name: 'kind' } },
            routes: { type: { notes: ['See /{type}/{nope}.'] } },
        });

        assert.deepEqual(find(manifest, 'type').notes, ['See /{kind}/{nope}.']);
    });

    test('a token that names no param is left as written', () => {
        const manifest = build({ ...MINIMAL.manifest, routes: { type: { notes: ['{nope} {constructor}'] } } });

        assert.deepEqual(find(manifest, 'type').notes, ['{nope} {constructor}']);
    });
});

describe('loadConfig', () => {
    test('resolves packagesDir and the asset files against the folder of the file', () => {
        assert.equal(config.packagesDir, join(rootDir, 'packages'));

        for (const [url, file] of Object.entries(config.assets)) {
            assert.ok(url.startsWith('/'));
            assert.ok(fs.statSync(file).isFile(), `${url} serves ${file}`);
        }
    });

    test('resolves a relative packagesDir and assets against the folder of the file, not the working directory', () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'dropr-config-'));
        const file = join(dir, 'config.json');
        const input = { ...MINIMAL, packagesDir: 'tree', assets: { '/a.txt': 'files/a.txt' } };
        fs.writeFileSync(file, JSON.stringify(input));

        try {
            const loaded = loadConfig(file);

            assert.notEqual(dir, process.cwd());
            assert.equal(loaded.packagesDir, join(dir, 'tree'));
            assert.deepEqual(loaded.assets, { '/a.txt': join(dir, 'files', 'a.txt') });
        } finally {
            fs.unlinkSync(file);
            fs.rmdirSync(dir);
        }
    });

    test('names the file when it is missing or is not JSON', () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'dropr-config-'));
        const broken = join(dir, 'broken.json');
        fs.writeFileSync(broken, '{ "name": ');

        try {
            assert.throws(() => loadConfig(broken), new RegExp(`^Error: Invalid config: ${broken} is not valid JSON`));
            assert.throws(
                () => loadConfig(join(dir, 'missing.json')),
                /Invalid config: .*missing\.json cannot be read/,
            );
        } finally {
            fs.unlinkSync(broken);
            fs.rmdirSync(dir);
        }
    });
});
