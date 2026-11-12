import assert from 'assert/strict';
import fs from 'fs';
import type { Server } from 'http';
import { describe, test } from 'node:test';
import os from 'os';
import { dirname, join } from 'path';

import { serve } from '../dist/serve.js';
import { scan } from '../dist/scan.js';
import { readIndex, verifyIndex } from '../dist/stored.js';
import { configure } from '../dist/startup.js';
import type { Index } from '../dist/types/index.js';

import { request, version } from './server.ts';

// Files of the small tree, by path under the packages folder
const FILES: Record<string, string> = {
    'npm/lib/.versions.json': '{ "1.0.0": { "date": "2025-01-01" }, "1.1.0": { "date": "2025-01-02" } }\n',
    'npm/lib/1.0.0/index.js': 'export default "lib";\n',
    'npm/lib/1.0.0/dist/a.js': 'export default "a";\n',
    'npm/lib/1.1.0/index.js': 'export default "lib 1.1";\n',
    'npm/other/.versions.json': '{ "1.0.0": { "date": "2025-01-03" } }\n',
    'npm/other/1.0.0/o.js': 'export default "o";\n',
    'bash/tool/.versions.json': '{ "1.0.0": { "date": "2025-02-01" } }\n',
    'bash/tool/1.0.0/tool': '#!/bin/bash\necho tool\n',
};

const SILENT = { error: () => undefined };

/**
 * A packages tree in a temporary folder, with remove() deleting exactly what was made there.
 */
interface Tree {
    root: string;
    packages: string;
    remove: () => void;
}

/**
 * Writes the small packages tree into a new temporary folder.
 *
 * @returns The folder, its packages folder and remove(), which deletes the entries written here and nothing else; an
 * entry that a test already took away is skipped and a folder that a test put in a file's place goes through rmdir
 */
function makeTree(): Tree {
    const root = fs.mkdtempSync(join(os.tmpdir(), 'dropr-stored-'));
    const packages = join(root, 'packages');
    const created = [root, packages];

    for (const [path, content] of Object.entries(FILES)) {
        const file = join(packages, path);
        const folders: string[] = [];
        for (let folder = dirname(file); !fs.existsSync(folder); folder = dirname(folder)) folders.unshift(folder);
        for (const folder of folders) {
            fs.mkdirSync(folder);
            created.push(folder);
        }
        fs.writeFileSync(file, content);
        created.push(file);
    }

    return {
        root,
        packages,
        remove: () => {
            for (const path of [...created].reverse()) {
                const stats = fs.lstatSync(path, { throwIfNoEntry: false });
                if (stats === undefined) continue;
                if (stats.isDirectory()) fs.rmdirSync(path);
                else fs.unlinkSync(path);
            }
        },
    };
}

/**
 * Writes the index of a tree to a file beside its packages folder.
 *
 * @param tree - Tree to index
 * @param edit - Change made to the index before it is written, none by default
 * @returns The path of the file, which the tree's remove() does not know: the caller unlinks it
 */
function writeIndex(tree: Tree, edit: (index: Index) => void = () => undefined): string {
    const index = scan(tree.packages, SILENT);
    edit(index);
    const file = join(tree.root, 'index.json');
    fs.writeFileSync(file, JSON.stringify(index));

    return file;
}

/**
 * Closes a server and its connections.
 *
 * @param server - Server returned by serve()
 */
function stop(server: Server): Promise<void> {
    return new Promise((resolve) => (server.close(() => resolve()), server.closeAllConnections()));
}

describe('an index read back from a file', () => {
    test('matches the folder it was made from', () => {
        const tree = makeTree();

        try {
            assert.deepEqual(verifyIndex(scan(tree.packages, SILENT), tree.packages), []);
        } finally {
            tree.remove();
        }
    });

    test('names a file that is missing, has another size or is not a regular file, a link included', () => {
        const tree = makeTree();

        try {
            const index = scan(tree.packages, SILENT);
            const lib = join(tree.packages, 'npm/lib');
            fs.unlinkSync(join(lib, '1.0.0/index.js'));
            fs.appendFileSync(join(lib, '1.0.0/dist/a.js'), 'x');
            fs.writeFileSync(join(lib, '1.1.0/index.js'), 'x');
            fs.unlinkSync(join(tree.packages, 'bash/tool/1.0.0/tool'));
            fs.mkdirSync(join(tree.packages, 'bash/tool/1.0.0/tool'));
            fs.unlinkSync(join(tree.packages, 'npm/other/1.0.0/o.js'));
            fs.symlinkSync(join(lib, '1.0.0/dist/a.js'), join(tree.packages, 'npm/other/1.0.0/o.js'));

            assert.deepEqual(verifyIndex(index, tree.packages), [
                'bash/tool/1.0.0/tool: not a regular file',
                'npm/lib/1.0.0/dist/a.js: 21 bytes, 20 indexed',
                'npm/lib/1.0.0/index.js: missing',
                `npm/lib/1.1.0/index.js: 1 bytes, ${FILES['npm/lib/1.1.0/index.js'].length} indexed`,
                'npm/other/1.0.0/o.js: not a regular file',
            ]);
        } finally {
            tree.remove();
        }
    });

    test('names a folder that is a link, however far its files are, and a folder that is gone', () => {
        const tree = makeTree();
        const outside = join(tree.root, 'outside');
        const copy = join(outside, 'a.js');

        try {
            const index = scan(tree.packages, SILENT);
            fs.mkdirSync(outside);
            fs.writeFileSync(copy, FILES['npm/lib/1.0.0/dist/a.js']);
            fs.unlinkSync(join(tree.packages, 'npm/lib/1.0.0/dist/a.js'));
            fs.rmdirSync(join(tree.packages, 'npm/lib/1.0.0/dist'));
            fs.symlinkSync(outside, join(tree.packages, 'npm/lib/1.0.0/dist'));
            fs.unlinkSync(join(tree.packages, 'npm/other/1.0.0/o.js'));
            fs.rmdirSync(join(tree.packages, 'npm/other/1.0.0'));
            fs.unlinkSync(join(tree.packages, 'npm/other/.versions.json'));
            fs.rmdirSync(join(tree.packages, 'npm/other'));

            assert.deepEqual(verifyIndex(index, tree.packages), [
                'npm/lib/1.0.0/dist: not a folder',
                'npm/other: missing',
            ]);
        } finally {
            fs.unlinkSync(copy);
            fs.rmdirSync(outside);
            tree.remove();
        }
    });

    test('names a file or a folder that cannot be looked at or read', { skip: process.getuid?.() === 0 }, () => {
        const tree = makeTree();
        const sealed = join(tree.packages, 'bash/tool/1.0.0');
        const unreadable = join(tree.packages, 'npm/other/1.0.0/o.js');

        try {
            const index = scan(tree.packages, SILENT);
            fs.chmodSync(sealed, 0o000);
            fs.chmodSync(unreadable, 0o000);

            assert.deepEqual(verifyIndex(index, tree.packages), [
                'bash/tool/1.0.0/tool: cannot be looked at (EACCES)',
                'npm/other/1.0.0/o.js: cannot be read',
            ]);
        } finally {
            fs.chmodSync(sealed, 0o755);
            tree.remove();
        }
    });

    test('names a type that a server would not serve', () => {
        const tree = makeTree();

        try {
            const index = scan(tree.packages, SILENT);

            assert.deepEqual(verifyIndex(index, tree.packages, ['npm']), ['npm: reserved name']);
            assert.deepEqual(verifyIndex(index, tree.packages, ['bash', 'npm']), [
                'bash: reserved name',
                'npm: reserved name',
            ]);
        } finally {
            tree.remove();
        }
    });

    test('is returned once the core accepts it and the folder matches', () => {
        const tree = makeTree();
        const file = writeIndex(tree);

        try {
            assert.deepEqual(readIndex(file, tree.packages), scan(tree.packages, SILENT));
        } finally {
            fs.unlinkSync(file);
            tree.remove();
        }
    });

    test('is refused when the file is missing, is not JSON, or the core cannot serve it', () => {
        const tree = makeTree();
        const file = join(tree.root, 'index.json');

        try {
            assert.throws(() => readIndex(file, tree.packages), /^Error: Cannot read the index .*ENOENT/);

            fs.writeFileSync(file, 'not json');
            assert.throws(() => readIndex(file, tree.packages), /^Error: Cannot read the index /);

            fs.writeFileSync(file, JSON.stringify({ format: 1, types: [] }));
            assert.throws(
                () => readIndex(file, tree.packages),
                /^Error: The index .* is not valid: Unsupported packages index format: 1$/,
            );

            fs.writeFileSync(file, JSON.stringify({ format: 2 }));
            assert.throws(() => readIndex(file, tree.packages), /^Error: The index .* is not valid: /);
        } finally {
            if (fs.existsSync(file)) fs.unlinkSync(file);
            tree.remove();
        }
    });

    test('is refused when the folder does not match, the first problems named and the others counted', () => {
        const cases: [number, RegExp][] = [
            [1, /, 1 problem:\nnpm\/lib\/1\.0\.0\/f0\.js: missing\nRun dropr index again\.$/],
            [5, /, 5 problems:\n(npm\/lib\/1\.0\.0\/f\d\.js: missing\n){5}Run dropr index again\.$/],
            [6, /, 6 problems:\n(npm\/lib\/1\.0\.0\/f\d\.js: missing\n){5}\.\.\. and 1 more\nRun dropr/],
            [7, /, 7 problems:\n(npm\/lib\/1\.0\.0\/f\d\.js: missing\n){5}\.\.\. and 2 more\nRun dropr/],
        ];

        for (const [length, message] of cases) {
            const tree = makeTree();
            const file = writeIndex(tree, (index) => {
                index.types[1].projects[0].versions[0].root.entries = Array.from({ length }, (_, n) => ({
                    kind: 'file' as const,
                    name: `f${n}.js`,
                    size: 1,
                    exec: false,
                    sha256: 'a'.repeat(64),
                }));
            });

            try {
                assert.throws(() => readIndex(file, tree.packages), message, String(length));
                assert.throws(() => readIndex(file, tree.packages), /^Error: The index .* does not match .*, /);
            } finally {
                fs.unlinkSync(file);
                tree.remove();
            }
        }
    });

    test('is refused when it holds a type that an asset or a route takes', () => {
        const tree = makeTree();
        const file = writeIndex(tree);

        try {
            assert.deepEqual(readIndex(file, tree.packages, []), scan(tree.packages, SILENT));
            assert.throws(() => readIndex(file, tree.packages, ['bash']), /, 1 problem:\nbash: reserved name\n/);
        } finally {
            fs.unlinkSync(file);
            tree.remove();
        }
    });
});

describe('serve with an index file', () => {
    test('serves what the index lists, read from the folder, without scanning it', async () => {
        const tree = makeTree();
        const file = writeIndex(tree, (index) => {
            index.types = index.types.filter(({ name }) => name === 'npm');
        });
        const { config } = configure(undefined, tree.root, 'packages', 0);
        const lines: string[] = [];
        let server: Server | undefined;

        try {
            server = await serve(config, version, (text) => lines.push(text), file);
            const { port } = server.address() as { port: number };

            const served = await request(port, 'GET', '/npm/lib@1.0.0/index.js');
            assert.equal(served.status, 200);
            assert.equal(served.body.toString(), FILES['npm/lib/1.0.0/index.js']);

            const health = JSON.parse((await request(port, 'GET', '/health')).body.toString());
            assert.equal(health.packages, 2);
            assert.equal((await request(port, 'GET', '/bash/tool@1.0.0/tool')).status, 404);
            assert.match(lines[0], /is running on/);
        } finally {
            if (server) await stop(server);
            fs.unlinkSync(file);
            tree.remove();
        }
    });

    test('does not listen when the index does not match the folder', async () => {
        const tree = makeTree();
        const file = writeIndex(tree);
        fs.appendFileSync(join(tree.packages, 'bash/tool/1.0.0/tool'), 'more');
        const { config } = configure(undefined, tree.root, 'packages', 0);
        const lines: string[] = [];

        try {
            await assert.rejects(
                serve(config, version, (text) => lines.push(text), file),
                /does not match/,
            );
            assert.deepEqual(lines, []);
        } finally {
            fs.unlinkSync(file);
            tree.remove();
        }
    });
});
