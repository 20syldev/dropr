import assert from 'assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { builtinModules } from 'module';
import { before, describe, test } from 'node:test';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import type { SandboxAnswer, SandboxRejection, SandboxRun } from './sandbox.ts';
import { rootDir } from './server.ts';
import { readArchive } from './tar.ts';

const ENTRIES = ['dist/core.js'];
const LIMITER = fileURLToPath(import.meta.resolve('@moxon/limiter'));
const HELPER = join(rootDir, 'test', 'sandbox.ts');

/**
 * Reads the specifiers that a compiled module imports or re-exports, and whether it imports dynamically.
 *
 * @param file - Absolute path of a JavaScript module written by tsc, one import or export per statement
 * @returns The static specifiers in order of appearance, and dynamic true when the file holds an import() call
 */
function importsOf(file: string): { specifiers: string[]; dynamic: boolean } {
    const source = fs.readFileSync(file, 'utf-8');
    const statics = /^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
    const specifiers = [...source.matchAll(statics)].map((match) => match[1] ?? match[2]);

    return { specifiers, dynamic: /\bimport\s*\(/.test(source) };
}

/**
 * Walks the imports of some modules, following the relative ones and the limiter, which is the one package allowed.
 *
 * @param entries - Paths of compiled modules, relative to the package root
 * @returns The files reached, the packages and Node modules named, and whether any file imports dynamically
 */
function walk(entries: string[]): { files: Set<string>; external: string[]; dynamic: boolean } {
    const files = new Set<string>();
    const external = new Set<string>();
    const queue = entries.map((entry) => resolve(rootDir, entry));
    let dynamic = false;

    while (queue.length) {
        const file = queue.pop()!;
        if (files.has(file)) continue;

        files.add(file);
        const found = importsOf(file);
        dynamic ||= found.dynamic;
        for (const specifier of found.specifiers) {
            if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
            else if (specifier === '@moxon/limiter') queue.push(LIMITER);
            else external.add(specifier);
        }
    }

    return { files, external: [...external].sort(), dynamic };
}

/**
 * Runs the sandbox helper in a child process, since vm modules need an experimental flag of Node.
 *
 * @param mode - run to answer requests through the handler, reject to only load the files
 * @param entries - Compiled modules the helper loads, relative to the package root
 * @returns What the helper printed, parsed; throws with its error output when it fails
 */
function sandbox(mode: 'run', entries: string[]): SandboxRun;
function sandbox(mode: 'reject', entries: string[]): SandboxRejection;
function sandbox(mode: string, entries: string[]): SandboxRun | SandboxRejection {
    const args = ['--experimental-vm-modules', '--no-warnings', HELPER, mode, ...entries];
    const { status, stdout, stderr } = spawnSync(process.execPath, args, { cwd: rootDir, encoding: 'utf-8' });
    assert.equal(status, 0, stderr);

    return JSON.parse(stdout);
}

/**
 * Decodes the body of an answer of the helper.
 *
 * @param answer - Answer with its body as base64
 * @returns The body as bytes
 */
const bytesOf = ({ body }: SandboxAnswer): Buffer => Buffer.from(body, 'base64');

describe('the core without Node', () => {
    const reach = walk(ENTRIES);
    let result: SandboxRun;

    before(() => {
        result = sandbox('run', ENTRIES);
    });

    test('imports no Node module, no package but the limiter, and nothing dynamically', () => {
        assert.deepEqual(reach.external, []);
        assert.equal(reach.dynamic, false);
        for (const name of builtinModules) assert.ok(!(reach.external as string[]).includes(name), name);
    });

    test('reaches the router, the archive writer and the limiter, so the walk sees the whole graph', () => {
        const paths = [...reach.files];

        for (const path of [
            'dist/lib/route.js',
            'dist/lib/archive.js',
            'dist/lib/respond.js',
            'dist/lib/ui.js',
            'dist/lib/pages.js',
            'dist/lib/markdown.js',
        ]) {
            assert.ok(paths.includes(join(rootDir, path)), path);
        }
        assert.ok(paths.includes(LIMITER));
        assert.ok(paths.length > 10, `${paths.length} files`);
    });

    test('runs in a context that has no process, no Buffer, no timer and no require', () => {
        assert.deepEqual(result.missing, []);
    });

    test('answers the health check without memory, since nothing here can measure it', () => {
        const health = JSON.parse(bytesOf(result.answers.health).toString());

        assert.equal(result.answers.health.status, 200);
        assert.deepEqual([health.status, health.version, health.memory], ['ok', '9.9.9', undefined]);
    });

    test('answers the listing, the search and the manifest', () => {
        const { listing, search, manifest } = result.answers;

        assert.deepEqual([listing.status, search.status, manifest.status], [200, 200, 200]);
        assert.ok(JSON.parse(bytesOf(listing).toString()).packages.npm);
        assert.deepEqual(
            JSON.parse(bytesOf(search).toString()).results.map(({ name }: { name: string }) => name),
            ['lib'],
        );
        assert.equal(JSON.parse(bytesOf(manifest).toString()).baseUrl, 'https://cdn.example.com');
    });

    test('answers a browser with pages, the README rendered, and the data to a client that wants it', () => {
        const { home, project, folder, missing, data } = result.answers;

        assert.deepEqual([home.status, project.status, folder.status, missing.status], [200, 200, 200, 404]);
        for (const answer of [home, project, folder, missing]) {
            assert.equal(answer.headers['content-type'], 'text/html; charset=utf-8');
            assert.equal(answer.headers.vary, 'Accept');
            assert.equal(answer.headers['content-length'], String(bytesOf(answer).length));
        }
        assert.match(bytesOf(home).toString(), /<h2><a href="\/npm">npm<\/a><\/h2>/);
        assert.match(bytesOf(project).toString(), /<h2>README<\/h2>\n<h3 id="gft">gft<\/h3>/);
        assert.match(bytesOf(folder).toString(), /<h1>lib@1\.2\.0\/dist<\/h1>/);
        assert.match(bytesOf(missing).toString(), /Package type &#39;nope&#39; does not exist\./);
        assert.match(String(data.headers['content-type']), /^application\/json/);
        assert.equal(data.headers.vary, 'Accept');
    });

    test('serves a file whole, a range of it, a conditional hit and a HEAD', () => {
        const { file, range, conditional, head } = result.answers;

        assert.equal(bytesOf(file).toString(), 'export default "1.2.0";\n');
        assert.deepEqual(
            [range.status, bytesOf(range).toString(), range.headers['content-range']],
            [206, 'export', 'bytes 0-5/24'],
        );
        assert.deepEqual([conditional.status, bytesOf(conditional).length], [304, 0]);
        assert.deepEqual([head.status, head.headers['content-length'], bytesOf(head).length], [200, '24', 0]);
    });

    test('answers a preflight, and a 404 when the read port fails', () => {
        const { preflight, absent } = result.answers;

        assert.equal(preflight.status, 204);
        assert.equal(absent.status, 404);
    });

    test('writes the archive of a version as gzip, with CompressionStream', () => {
        const { archive } = result.answers;
        const files = readArchive(bytesOf(archive)).filter((entry) => entry.type === 'file');

        assert.equal(archive.status, 200);
        assert.equal(archive.headers['content-type'], 'application/gzip');
        assert.ok(files.some((entry) => entry.path.endsWith('index.js')));
    });

    test('refuses the third request of a client with a Retry-After', () => {
        const { limited } = result.answers;

        assert.equal(limited.status, 429);
        assert.match(limited.headers['retry-after']!, /^\d+$/);
    });

    test('is checked by a loader that does refuse a Node module', () => {
        const { error } = sandbox('reject', ['dist/index.js']);

        assert.match(error!, /imports [\w:/]+, a module of Node/);
    });
});
