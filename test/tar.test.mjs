import assert from 'assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { describe, test } from 'node:test';
import os from 'os';
import { join } from 'path';
import zlib from 'zlib';

import { archiveEntries, archiveStream } from '../dist/lib/archive.js';
import { loadIndex } from '../dist/lib/packages.js';

import { sha256 } from './server.mjs';
import { collect, readArchive } from './tar.mjs';

// Release date of the archived version, which every entry carries whatever the dates of its files
const RELEASE = '2025-03-01';

// File dates of the index (2025-01-01T12:00:00.9996Z), none of them the release date
const MTIME = 1735732800999.6;

// Folder names that put a file at 155 + 100 bytes and at 300 bytes from the archive root
const SPLIT = 'd'.repeat(149);
const LONG = 'g'.repeat(200);

/**
 * Root entries of the archived version, in strcmp order: archive paths of 99, 100, 101, 155 + 100 and 300 bytes,
 * UTF-8 names, one of them too long for the name field, an empty file, an executable, and links to a file, to a
 * folder and, with a 120-byte target, to nowhere.
 */
const ROOT = [
    file('a'.repeat(93)),
    file('b'.repeat(94)),
    folder('bin', [file('bin/run', true)]),
    file('c'.repeat(95)),
    folder(SPLIT, [file(`${SPLIT}/${'e'.repeat(100)}`)]),
    file('empty'),
    link('far', 't'.repeat(120), null),
    link('folder', 'bin', 'bin'),
    folder(LONG, [file(`${LONG}/${'h'.repeat(93)}`)]),
    file('index.js'),
    link('inside', 'index.js', 'index.js'),
    file(`x${'\u00e9'.repeat(60)}`),
    file('\u00e9.txt'),
    file('\u65e5\u672c.md'),
];

// Version 1.0.0 of the npm project tool, released on RELEASE
const version = loadIndex({
    format: 1,
    types: [{ name: 'npm', projects: [{ name: 'tool', deprecated: null, versions: [release(RELEASE)] }] }],
}).versions.get('npm/tool/1.0.0');

// Entries of the archive of the version, as the download routes stream them
const entries = archiveEntries(version);

/**
 * Gives the content of a file of the archived version, derived from its path so that no table has to hold it.
 *
 * @param path - Path of the file under the version folder
 * @returns Nothing for the file named empty, else the path followed by a newline
 */
function contentOf(path) {
    return Buffer.from(path === 'empty' ? '' : `${path}\n`);
}

/**
 * Builds a file node of the index, its size and hash those of contentOf.
 *
 * @param path - Path of the file under the version folder, its last segment being its name
 * @param exec - Whether the owner may execute it, false by default
 * @returns The file node, dated MTIME
 */
function file(path, exec = false) {
    const content = contentOf(path);

    return {
        kind: 'file',
        name: path.split('/').at(-1),
        mtime: MTIME,
        size: content.length,
        exec,
        sha256: sha256(content),
    };
}

/**
 * Builds a folder node of the index.
 *
 * @param name - Folder name
 * @param entries - Nodes of the folder in strcmp order
 * @returns The folder node, its size left at 0 since archives never read it
 */
function folder(name, entries) {
    return { kind: 'dir', name, size: 0, entries };
}

/**
 * Builds a link node of the index.
 *
 * @param name - Link name
 * @param target - Raw target, written as is in the archive
 * @param real - Real target relative to the version folder, null when it leads nowhere
 * @returns The link node
 */
function link(name, target, real) {
    return { kind: 'link', name, target, real };
}

/**
 * Builds version 1.0.0 of the index, its root holding ROOT.
 *
 * @param date - Release date, a YYYY-MM-DD day or any text that does not parse as a date
 * @returns The version node
 */
function release(date) {
    return { name: '1.0.0', date, root: folder('1.0.0', ROOT) };
}

/**
 * Reads a file of the archived version, as the adapter reads one from the packages folder.
 *
 * @param source - Path under the packages root, npm/tool/1.0.0/ followed by the path under the version folder
 * @returns The content given by contentOf
 */
async function read(source) {
    return contentOf(source.slice('npm/tool/1.0.0/'.length));
}

/**
 * Reads a NUL-terminated field of a tar header as raw bytes.
 *
 * @param block - 512-byte header block
 * @param start - Offset of the field in the block
 * @param length - Field width in bytes
 * @returns The bytes before the first NUL, the whole field when it has none
 */
function field(block, start, length) {
    const value = block.subarray(start, start + length);
    const end = value.indexOf(0);

    return end === -1 ? value : value.subarray(0, end);
}

/**
 * Reads a numeric field of a tar header.
 *
 * @param block - 512-byte header block
 * @param start - Offset of the field in the block
 * @param length - Field width in bytes
 * @returns The octal digits of the field as a number, NaN when the field is blank
 */
function octal(block, start, length) {
    return parseInt(field(block, start, length).toString(), 8);
}

/**
 * Lists the header blocks of an uncompressed archive, a pax header and the ustar header it extends apart.
 *
 * @param bytes - Tar bytes, read up to the first zero block
 * @returns Per header its typeflag, its name and prefix fields as raw bytes, its uid/gid and uname/gname pairs and
 * its mtime in seconds
 */
function headers(bytes) {
    const found = [];
    for (let offset = 0; offset < bytes.length && bytes[offset] !== 0;) {
        const block = bytes.subarray(offset, offset + 512);

        found.push({
            type: String.fromCharCode(block[156]),
            name: field(block, 0, 100),
            prefix: field(block, 345, 155),
            owner: `${octal(block, 108, 8)}/${octal(block, 116, 8)}`,
            names: `${field(block, 265, 32)}/${field(block, 297, 32)}`,
            mtime: octal(block, 136, 12),
        });
        offset += 512 + Math.ceil(octal(block, 124, 12) / 512) * 512;
    }

    return found;
}

/**
 * Formats the permissions of an entry the way tar -tv prints them.
 *
 * @param entry - Archive entry, its kind giving the leading letter
 * @returns Ten characters, such as drwxr-xr-x or -rw-r--r--
 */
function permissions({ kind, mode }) {
    const bits = [...mode.toString(2).padStart(9, '0')].map((bit, i) => (bit === '1' ? 'rwx'[i % 3] : '-'));

    return `${{ dir: 'd', file: '-', link: 'l' }[kind]}${bits.join('')}`;
}

/**
 * Runs the system tar on an archive, in UTC and with names printed as they are.
 *
 * @param args - Arguments, the archive being read from stdin with -f -
 * @param archive - Gzipped tar bytes given on stdin
 * @returns The exit status, stdout and stderr as UTF-8 text
 */
function systemTar(args, archive) {
    const env = { ...process.env, TZ: 'UTC', LC_ALL: 'C.UTF-8' };
    const { status, stdout, stderr } = spawnSync('tar', args, { input: archive, env, encoding: 'utf-8' });

    return { status, stdout, stderr };
}

/**
 * Deletes what an extraction wrote, children before their folder, then the extraction folder itself.
 * Folders go through rmdir, which refuses a folder that is not empty, so nothing the archive did not hold is deleted.
 *
 * @param dir - Extraction folder
 * @param written - Entries of the archive, in archive order; the ones missing on disk are passed over
 */
function removeExtracted(dir, written) {
    for (const { path } of [...written].reverse()) {
        const target = join(dir, path);
        const stat = fs.lstatSync(target, { throwIfNoEntry: false });
        if (!stat) continue;

        if (stat.isDirectory()) fs.rmdirSync(target);
        else fs.unlinkSync(target);
    }
    fs.rmdirSync(dir);
}

describe('archiveEntries', () => {
    test('every entry carries the release date of the version, whatever the dates of its files', () => {
        const seconds = Date.parse(RELEASE) / 1000;

        assert.deepEqual(new Set(entries.map((entry) => entry.mtime)), new Set([seconds]));
    });

    test('a date that does not parse, or one before 1970, gives the epoch', () => {
        for (const date of ['unknown', '1969-12-31']) {
            assert.deepEqual(new Set(archiveEntries({ ...version, date }).map((entry) => entry.mtime)), new Set([0]));
        }
    });

    test('entries come in pre-order, links kept as links with nothing below them', () => {
        const listed = entries.map(({ kind, path, mode, size, target }) => [
            kind,
            path,
            mode.toString(8),
            size,
            target,
        ]);
        const e = 'e'.repeat(100);
        const h = 'h'.repeat(93);

        assert.deepEqual(listed, [
            ['dir', '1.0.0/', '755', 0, null],
            ['file', `1.0.0/${'a'.repeat(93)}`, '644', 94, null],
            ['file', `1.0.0/${'b'.repeat(94)}`, '644', 95, null],
            ['dir', '1.0.0/bin/', '755', 0, null],
            ['file', '1.0.0/bin/run', '755', 8, null],
            ['file', `1.0.0/${'c'.repeat(95)}`, '644', 96, null],
            ['dir', `1.0.0/${SPLIT}/`, '755', 0, null],
            ['file', `1.0.0/${SPLIT}/${e}`, '644', 251, null],
            ['file', '1.0.0/empty', '644', 0, null],
            ['link', '1.0.0/far', '777', 0, 't'.repeat(120)],
            ['link', '1.0.0/folder', '777', 0, 'bin'],
            ['dir', `1.0.0/${LONG}/`, '755', 0, null],
            ['file', `1.0.0/${LONG}/${h}`, '644', 295, null],
            ['file', '1.0.0/index.js', '644', 9, null],
            ['link', '1.0.0/inside', '777', 0, 'index.js'],
            ['file', `1.0.0/x${'\u00e9'.repeat(60)}`, '644', 122, null],
            ['file', '1.0.0/\u00e9.txt', '644', 7, null],
            ['file', '1.0.0/\u65e5\u672c.md', '644', 10, null],
        ]);
    });
});

describe('archiveStream', () => {
    test('two runs give the same bytes', async () => {
        const first = await collect(archiveStream(entries, read));
        const second = await collect(archiveStream(entries, read));

        assert.ok(first.equals(second));
    });

    test('the archive ends with two zero blocks and is padded to a multiple of 10240 bytes', async () => {
        const tar = zlib.gunzipSync(await collect(archiveStream(entries, read)));

        assert.equal(tar.length % 10240, 0);
        assert.ok(tar.subarray(-1024).every((byte) => byte === 0));
    });

    test('headers are owned by 0/0 without names, dated the release, and pax only holds what ustar cannot', async () => {
        const found = headers(zlib.gunzipSync(await collect(archiveStream(entries, read))));
        const seconds = Date.parse(RELEASE) / 1000;
        const ustar = found.filter(({ type }) => type !== 'x');

        assert.equal(ustar.length, entries.length);
        for (const header of found) assert.deepEqual([header.owner, header.names, header.mtime], ['0/0', '/', seconds]);

        // Paths of 156, 207, 300 and 127 bytes, and the 120-byte link target, have no ustar form
        assert.equal(found.length - ustar.length, 5);

        const split = ustar.find(({ name }) => name.toString() === 'e'.repeat(100));
        assert.equal(split.prefix.toString(), `1.0.0/${SPLIT}`);
        assert.equal(ustar.find(({ name }) => name.toString() === 'c'.repeat(95)).prefix.toString(), '1.0.0');

        const accented = ustar.find(({ name }) => name.toString().startsWith('1.0.0/x'));
        const kept = new TextDecoder('utf-8', { fatal: true }).decode(accented.name);
        assert.equal(accented.name.length, 99);
        assert.ok(`1.0.0/x${'\u00e9'.repeat(60)}`.startsWith(kept));
    });

    test('readArchive reads back every entry, its content and its link target', async () => {
        const archive = await collect(archiveStream(entries, read));
        const expected = entries.map(({ kind, path, target }) => {
            if (kind === 'dir') return { path, type: 'dir' };
            if (kind === 'link') return { path, type: 'link', target };

            const content = contentOf(path.slice('1.0.0/'.length));
            return { path, type: 'file', size: content.length, sha256: sha256(content) };
        });

        assert.deepEqual(
            readArchive(archive),
            expected.sort((a, b) => (a.path < b.path ? -1 : 1)),
        );
    });

    test('the system tar lists every entry with its mode, owner 0/0, size, release date and link target', async () => {
        const { status, stdout, stderr } = systemTar(
            ['--full-time', '--quoting-style=literal', '-tvzf', '-'],
            await collect(archiveStream(entries, read)),
        );
        const listed = stdout
            .trimEnd()
            .split('\n')
            .map((line) => /^(\S{10}) (\S+) +(\d+) (\S+ \S+) (.*)$/.exec(line).slice(1));
        const expected = entries.map((entry) => {
            const name = entry.kind === 'link' ? `${entry.path} -> ${entry.target}` : entry.path;
            return [permissions(entry), '0/0', String(entry.size), `${RELEASE} 00:00:00`, name];
        });

        assert.equal(stderr, '');
        assert.equal(status, 0);
        assert.deepEqual(listed, expected);
    });

    test('the system tar restores the bytes, the execute bits, the links and the release date', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'dropr-tar-'));

        try {
            const { status, stderr } = systemTar(['-xzf', '-', '-C', dir], await collect(archiveStream(entries, read)));
            assert.equal(stderr, '');
            assert.equal(status, 0);

            for (const { kind, path, mode, target } of entries) {
                const restored = join(dir, path);
                const stat = fs.lstatSync(restored);

                if (kind === 'dir') assert.ok(stat.isDirectory(), path);
                if (kind === 'link') assert.equal(fs.readlinkSync(restored), target);
                if (kind !== 'file') continue;

                assert.ok(fs.readFileSync(restored).equals(contentOf(path.slice('1.0.0/'.length))), path);
                assert.equal(stat.mode & 0o100, mode & 0o100, path);
                assert.equal(stat.mtimeMs, Date.parse(RELEASE), path);
            }
        } finally {
            removeExtracted(dir, entries);
        }
    });

    test('a read that fails, falls short or runs long errors the stream', async () => {
        const failing = () => Promise.reject(new Error('EACCES: permission denied'));
        const short = async (source) => (await read(source)).subarray(1);
        const long = async (source) => Buffer.concat([await read(source), Buffer.from('+')]);

        await assert.rejects(collect(archiveStream(entries, failing)), /EACCES/);
        await assert.rejects(collect(archiveStream(entries, short)), /has 93 bytes, the index has 94$/);
        await assert.rejects(collect(archiveStream(entries, long)), /has 95 bytes, the index has 94$/);
    });

    test('a file of 8 GiB or more errors the stream before it is read', async () => {
        const size = 8 * 1024 ** 3;
        const huge = { kind: 'file', path: 'huge.bin', mode: 0o644, mtime: 0, size, target: null, source: 'huge.bin' };

        await assert.rejects(collect(archiveStream([huge], () => assert.fail('nothing is read'))), RangeError);
    });
});
