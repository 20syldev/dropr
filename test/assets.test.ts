import assert from 'assert/strict';
import fs from 'fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import os from 'os';
import { join } from 'path';

import { scanAssets } from '../dist/assets.js';

import { sha256 } from './server.ts';
import { collect } from './tar.ts';

const MODIFIED = new Date('2025-05-01T00:00:00Z');

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(join(os.tmpdir(), 'dropr-assets-'));
});

afterEach(() => {
    for (const name of fs.readdirSync(root)) {
        const path = join(root, name);
        if (fs.statSync(path).isDirectory()) fs.rmdirSync(path);
        else fs.unlinkSync(path);
    }
    fs.rmdirSync(root);
});

/**
 * Writes an asset file with a known modification time.
 *
 * @param name - File name under the temporary folder
 * @param content - Bytes of the file
 * @returns The absolute path of the file
 */
function write(name: string, content: string | Buffer): string {
    const file = join(root, name);
    fs.writeFileSync(file, content);
    fs.utimesSync(file, MODIFIED, MODIFIED);

    return file;
}

describe('scanAssets', () => {
    test('reads the strong SHA-256 tag, the size and the modification time of each asset', () => {
        const text = 'User-agent: *\nDisallow: /\n';
        const assets = scanAssets({ '/robots.txt': write('robots.txt', text) }, { error() {} });

        assert.deepEqual(Object.keys(assets), ['/robots.txt']);
        assert.equal(assets['/robots.txt'].etag, `"${sha256(Buffer.from(text))}"`);
        assert.equal(assets['/robots.txt'].size, text.length);
        assert.equal(assets['/robots.txt'].lastModified, MODIFIED.getTime());
    });

    test('hashes a file of many chunks and an empty one', () => {
        const big = Buffer.alloc(300_000, 'abc');
        const assets = scanAssets({ '/big': write('big', big), '/empty': write('empty', '') }, { error() {} });

        assert.equal(assets['/big'].etag, `"${sha256(big)}"`);
        assert.equal(assets['/empty'].etag, `"${sha256(Buffer.alloc(0))}"`);
        assert.equal(assets['/empty'].size, 0);
    });

    test('gives the type of the extension of the file, not of the URL', () => {
        const assets = scanAssets(
            { '/icon': write('a.ico', 'i'), '/robots': write('r.txt', 'r'), '/x.png': write('l.svg', '<svg/>') },
            { error() {} },
        );

        assert.equal(assets['/icon'].contentType, 'image/x-icon');
        assert.equal(assets['/robots'].contentType, 'text/plain; charset=utf-8');
        assert.equal(assets['/x.png'].contentType, 'image/svg+xml');
    });

    test('opens the whole file or a range of it', async () => {
        const assets = scanAssets({ '/a.txt': write('a.txt', '0123456789') }, { error() {} });

        assert.equal((await collect(await assets['/a.txt'].open())).toString(), '0123456789');
        assert.equal((await collect(await assets['/a.txt'].open({ start: 3, end: 5 }))).toString(), '345');
    });

    test('opens the file named by its own path, whatever the other assets are', async () => {
        const files = { '/one': write('one.txt', '1'), '/two': write('two.txt', '22') };
        const assets = scanAssets(files, { error() {} });

        assert.equal((await collect(await assets['/two'].open())).toString(), '22');
        assert.equal((await collect(await assets['/one'].open())).toString(), '1');
    });

    test('logs and leaves out a file that is missing and a folder, and keeps the others', () => {
        fs.mkdirSync(join(root, 'folder'));
        const logged: string[] = [];
        const assets = scanAssets(
            {
                '/missing': join(root, 'missing.txt'),
                '/folder': join(root, 'folder'),
                '/ok': write('ok.txt', 'ok'),
            },
            { error: (message: string) => logged.push(message) },
        );

        assert.deepEqual(Object.keys(assets), ['/ok']);
        assert.equal(logged.length, 2);
        assert.match(logged[0], /^Skipping asset '\/missing': ENOENT/);
        assert.equal(logged[1], "Skipping asset '/folder': not a regular file");
    });

    test('returns nothing for no asset', () => {
        assert.deepEqual(scanAssets({}, { error() {} }), {});
    });
});
