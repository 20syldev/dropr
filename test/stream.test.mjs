import assert from 'assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import { after, describe, test } from 'node:test';
import os from 'os';
import { join } from 'path';

import { createReader } from '../dist/disk.js';
import { archiveEntries, archiveStream } from '../dist/lib/archive.js';
import { loadIndex } from '../dist/lib/packages.js';
import { exact, watch } from '../dist/lib/stream.js';

import { chunked, eventually, memoryPort } from './port.mjs';
import { collect, readArchive } from './tar.mjs';

/**
 * Builds a byte stream that records how it ends.
 *
 * @param chunks - Chunks to enqueue, one per pull; an Error is thrown when its turn comes
 * @returns The stream and its log: how many chunks were pulled and whether it was cancelled
 */
function recorded(chunks) {
    const log = { pulled: 0, cancelled: false };
    const stream = new ReadableStream(
        {
            pull(controller) {
                const next = chunks[log.pulled++];
                if (next === undefined) return controller.close();
                if (next instanceof Error) throw next;

                controller.enqueue(new Uint8Array(next));
            },
            cancel: () => void (log.cancelled = true),
        },
        { highWaterMark: 0 },
    );

    return { stream, log };
}

describe('exact', () => {
    test('passes the bytes of a source of the right length, whatever its chunks', async () => {
        for (const size of [1, 2, 3, 7, 100]) {
            assert.equal((await collect(exact(chunked(Buffer.from('0123456789'), size), 10))).toString(), '0123456789');
        }
        assert.equal((await collect(exact(chunked(Buffer.alloc(0)), 0))).length, 0);
    });

    test('skips empty chunks', async () => {
        const { stream } = recorded([[], [1, 2], [], [3]]);

        assert.deepEqual([...(await collect(exact(stream, 3)))], [1, 2, 3]);
    });

    test('errors when the source ends early, naming how many bytes are missing', async () => {
        await assert.rejects(collect(exact(chunked(Buffer.from('abc')), 5)), /ended 2 bytes before the expected 5$/);
        await assert.rejects(collect(exact(chunked(Buffer.alloc(0)), 1)), /ended 1 bytes before the expected 1$/);
    });

    test('errors when the source holds more, in the last chunk or after it', async () => {
        await assert.rejects(collect(exact(chunked(Buffer.from('abcdef'), 4), 5)), /more than the expected 5 bytes$/);
        await assert.rejects(collect(exact(chunked(Buffer.from('abcde'), 5), 4)), /more than the expected 4 bytes$/);
        await assert.rejects(collect(exact(chunked(Buffer.from('a')), 0)), /more than the expected 0 bytes$/);
    });

    test('cancels the source that holds more, whatever its cancel does', async () => {
        const long = recorded([
            [1, 2, 3],
            [4, 5, 6],
        ]);
        await assert.rejects(collect(exact(long.stream, 4)), /more than the expected 4 bytes$/);
        assert.equal(long.log.cancelled, true);

        const stubborn = new ReadableStream(
            {
                pull: (controller) => controller.enqueue(new Uint8Array(9)),
                cancel: () => {
                    throw new Error('EIO: close failed');
                },
            },
            { highWaterMark: 0 },
        );
        await assert.rejects(collect(exact(stubborn, 4)), /more than the expected 4 bytes$/);
    });

    test('passes on the error of the source, and cancels the source when it is cancelled', async () => {
        await assert.rejects(collect(exact(recorded([[1], new Error('EIO')]).stream, 4)), /EIO/);

        const { stream, log } = recorded([[1], [2], [3]]);
        const reader = exact(stream, 3).getReader();
        await reader.read();
        await reader.cancel();

        assert.equal(log.cancelled, true);
    });

    test('reads the source one chunk per read of the result', async () => {
        const { stream, log } = recorded(Array.from({ length: 1000 }, () => [1, 2, 3, 4]));
        const reader = exact(stream, 4000).getReader();
        for (let i = 0; i < 5; i++) await reader.read();
        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.equal(log.pulled, 5, `${log.pulled} chunks pulled for 5 reads`);
        await reader.cancel();
    });
});

describe('watch', () => {
    test('passes the bytes of the source on, and reports nothing when it ends', async () => {
        const reported = [];
        const { stream } = recorded([[1, 2], [3]]);

        assert.deepEqual([...(await collect(watch(stream, (error) => reported.push(error))))], [1, 2, 3]);
        assert.deepEqual(reported, []);
    });

    test('reports the error of the source once, and fails with the same error', async () => {
        const reported = [];
        const failure = new Error('disk');
        const { stream } = recorded([[1], failure]);

        await assert.rejects(collect(watch(stream, (error) => reported.push(error))), (error) => error === failure);
        assert.deepEqual(reported, [failure]);
    });

    test('reports the error of a stream that exact refuses', async () => {
        const reported = [];

        await assert.rejects(collect(watch(exact(chunked(Buffer.from('abc')), 5), (error) => reported.push(error))));
        assert.equal(reported.length, 1);
        assert.match(reported[0].message, /ended 2 bytes before the expected 5$/);
    });

    test('cancels the source with the reason when the result is cancelled, and reports nothing', async () => {
        const reported = [];
        const reasons = [];
        const source = new ReadableStream(
            {
                pull: (controller) => controller.enqueue(new Uint8Array(1)),
                cancel: (reason) => void reasons.push(reason),
            },
            { highWaterMark: 0 },
        );
        const reader = watch(source, (error) => reported.push(error)).getReader();

        await reader.read();
        await reader.cancel('gone');

        assert.deepEqual(reasons, ['gone']);
        assert.deepEqual(reported, []);
    });

    test('reports nothing for a read that was pending when the result was cancelled', async () => {
        const reported = [];
        let release;
        let started = false;
        const source = new ReadableStream(
            {
                pull: async (controller) => {
                    started = true;
                    await new Promise((resolve) => (release = resolve));
                    controller.enqueue(new Uint8Array(1));
                },
            },
            { highWaterMark: 0 },
        );
        const reader = watch(exact(source, 10), (error) => reported.push(error)).getReader();

        const pending = reader.read().catch(() => undefined);
        assert.equal(await eventually(() => started), true);
        await reader.cancel('gone');
        release();
        await pending;
        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.deepEqual(reported, []);
    });

    test('reads the source one chunk per read', async () => {
        const { stream, log } = recorded([[1], [2], [3]]);
        const reader = watch(stream, () => {}).getReader();

        await reader.read();
        assert.equal(log.pulled, 1);
        await reader.read();
        assert.equal(log.pulled, 2);
    });
});

describe('archiveStream through a read port', () => {
    const file = (name, size) => ({ kind: 'file', name, size, exec: false, sha256: '0'.repeat(64) });
    const folder = (name, entries) => ({ kind: 'dir', name, entries });
    const content = (path) => Buffer.from(`${path}:`.repeat(40)).subarray(0, 100 + (path.length % 7));
    const tree = [
        file('b.bin', content('b.bin').length),
        folder('d', [file('a.txt', content('d/a.txt').length)]),
        file('empty', 0),
    ];
    const index = {
        format: 2,
        types: [
            {
                name: 'npm',
                projects: [
                    { name: 'p', versions: [{ name: '1.0.0', date: '2025-01-01', root: folder('1.0.0', tree) }] },
                ],
            },
        ],
    };
    const entries = archiveEntries(loadIndex(index).types.get('npm').projects.get('p').versions.get('1.0.0'));
    const bytesOf = (source) =>
        source === 'npm/p/1.0.0/empty' ? Buffer.alloc(0) : content(source.slice('npm/p/1.0.0/'.length));

    test('gives the same bytes whatever the chunks of the port, and the entries read back', async () => {
        const reference = await collect(archiveStream(entries, memoryPort(bytesOf, { size: 5 })));

        for (const size of [1, 3, 64, 1_000_000]) {
            assert.ok(
                (await collect(archiveStream(entries, memoryPort(bytesOf, { size })))).equals(reference),
                `${size}`,
            );
        }
        const sizes = Object.fromEntries(
            readArchive(reference)
                .filter((entry) => entry.type === 'file')
                .map((entry) => [entry.path, entry.size]),
        );

        assert.deepEqual(sizes, {
            '1.0.0/b.bin': content('b.bin').length,
            '1.0.0/d/a.txt': content('d/a.txt').length,
            '1.0.0/empty': 0,
        });
    });

    test('opens every file, an empty one included, with no range', async () => {
        const asked = [];
        const spy = async (path, range) => (asked.push([path, range]), memoryPort(bytesOf)(path, range));
        await collect(archiveStream(entries, spy));

        assert.deepEqual(
            asked.map(([path]) => path),
            ['npm/p/1.0.0/b.bin', 'npm/p/1.0.0/d/a.txt', 'npm/p/1.0.0/empty'],
        );
        assert.ok(asked.every(([, range]) => range === undefined));
    });

    test('never stalls on empty files or files that fill whole blocks, whatever the pace of the reader', async () => {
        const sizes = [0, 512, 0, 1024, 513, 0, 10_240, 511, 0, 0];
        const many = Array.from({ length: 30 }, (_, at) => ({
            ...entries[0],
            kind: 'file',
            path: `1.0.0/f${at}`,
            size: sizes[at % sizes.length],
            source: `f${at}`,
        }));
        const sizeOf = new Map(many.map((entry) => [entry.source, entry.size]));
        const reader = archiveStream(
            many,
            memoryPort((source) => Buffer.alloc(sizeOf.get(source), 1), { size: 100 }),
        ).getReader();
        const chunks = [];
        const drained = (async () => {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) return true;

                chunks.push(value);
                await new Promise((resolve) => setTimeout(resolve, 1));
            }
        })();
        let timer;
        const patience = new Promise((resolve) => (timer = setTimeout(() => resolve(false), 5000)));
        const finished = await Promise.race([drained, patience]);
        clearTimeout(timer);

        assert.ok(finished, 'the archive stalled');
        const found = readArchive(Buffer.concat(chunks)).filter((entry) => entry.type === 'file');

        assert.deepEqual(
            Object.fromEntries(found.map((entry) => [entry.path, entry.size])),
            Object.fromEntries(many.map((entry) => [entry.path, entry.size])),
        );
    });

    test('errors when a port fails to open, fails midway, falls short or runs long', async () => {
        const open = () => Promise.reject(new Error('EACCES: permission denied'));
        const midway = async (path) =>
            recorded([[...bytesOf(path).subarray(0, 10)], new Error('EIO: read failed')]).stream;
        const short = memoryPort((path) => bytesOf(path).subarray(1));
        const long = memoryPort((path) => Buffer.concat([bytesOf(path), Buffer.from('+')]));

        await assert.rejects(collect(archiveStream(entries, open)), /EACCES/);
        await assert.rejects(collect(archiveStream(entries, midway)), /EIO/);
        await assert.rejects(collect(archiveStream(entries, short)), /bytes before the expected/);
        await assert.rejects(collect(archiveStream(entries, long)), /more than the expected/);
    });

    test('holds one chunk of a file at a time: a stalled reader leaves the port nearly unread', async () => {
        const big = { ...entries[0], kind: 'file', path: 'big', size: 10_000 * 65_536, source: 'big' };
        // Random bytes, which gzip cannot shrink: zeros would let the compressor swallow megabytes before it emits one chunk
        const noise = crypto.randomBytes(65_536);
        let pulled = 0;
        const port = async () =>
            new ReadableStream(
                {
                    pull(controller) {
                        if (pulled >= 10_000) return controller.close();

                        pulled++;
                        controller.enqueue(new Uint8Array(noise));
                    },
                },
                { highWaterMark: 0 },
            );
        const reader = archiveStream([big], port).getReader();
        await reader.read();
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.ok(pulled < 50, `${pulled} chunks of 64 KiB pulled for one chunk read`);
        await reader.cancel();
    });

    test('cancelling the archive cancels the file being read', async () => {
        const open = [];
        const port = async () => {
            const { stream, log } = recorded(Array.from({ length: 1000 }, () => new Array(1000).fill(1)));
            open.push(log);

            return stream;
        };
        const big = { ...entries[0], kind: 'file', path: 'big', size: 1_000_000, source: 'big' };
        const reader = archiveStream([big], port).getReader();
        await reader.read();
        await reader.cancel();

        assert.equal(open.length, 1);
        assert.ok(await eventually(() => open[0].cancelled), 'the file stream was not cancelled');
    });

    test('cancelling the archive while a file is being opened cancels that file once it is open', async () => {
        const log = { asked: false, cancelled: false };
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        const port = async () => {
            log.asked = true;
            await gate;

            return new ReadableStream({ cancel: () => void (log.cancelled = true) });
        };
        const one = { ...entries[0], kind: 'file', path: 'one', size: 4, source: 'one' };
        const reader = archiveStream([one], port).getReader();
        reader.read().catch(() => undefined);

        assert.ok(await eventually(() => log.asked), 'the file was not asked for');
        await reader.cancel();
        // The cancel must reach the archive before the file opens, or this test would not tell the two orders apart
        await new Promise((resolve) => setTimeout(resolve, 20));
        release();

        assert.ok(await eventually(() => log.cancelled), 'the file opened after the cancel was left open');
    });

    test('streams a file of more than 2 GiB a chunk at a time', async () => {
        const big = { ...entries[0], kind: 'file', path: 'big', size: 3 * 1024 ** 3, source: 'big' };
        // Random bytes, which gzip cannot shrink, so that it emits as the file comes
        const noise = crypto.randomBytes(65_536);
        let pulled = 0;
        const port = async () =>
            new ReadableStream(
                {
                    pull(controller) {
                        pulled++;
                        controller.enqueue(new Uint8Array(noise));
                    },
                },
                { highWaterMark: 0 },
            );
        const reader = archiveStream([big], port).getReader();
        for (let i = 0; i < 3; i++) assert.ok((await reader.read()).value.length > 0);
        await reader.cancel();

        assert.ok(pulled >= 1 && pulled < 50, `${pulled} chunks pulled`);
    });

    test('cancels the file that runs long', async () => {
        const open = [];
        const port = async () => {
            const { stream, log } = recorded([[1, 2, 3, 4, 5, 6, 7, 8, 9]]);
            open.push(log);

            return stream;
        };
        const short = { ...entries[0], kind: 'file', path: 'short', size: 4, source: 'short' };

        await assert.rejects(collect(archiveStream([short], port)), /more than the expected 4 bytes/);
        assert.equal(open.length, 1);
        assert.equal(open[0].cancelled, true);
    });
});

describe('createReader on a folder of files', () => {
    const folder = fs.mkdtempSync(join(os.tmpdir(), 'dropr-disk-'));
    const created = [];
    const write = (name, data) => {
        fs.writeFileSync(join(folder, name), data);
        created.push(join(folder, name));
    };
    const descriptors = () => fs.readdirSync('/proc/self/fd').length;
    const hasProc = fs.existsSync('/proc/self/fd');
    const read = createReader(folder);

    write('digits', Buffer.from('0123456789'.repeat(20_000)));
    write('empty', Buffer.alloc(0));

    after(() => {
        for (const path of created) fs.unlinkSync(path);
        fs.rmdirSync(folder);
    });

    test('streams a whole file, a range of it and the last byte', async () => {
        const all = fs.readFileSync(join(folder, 'digits'));

        assert.ok((await collect(await read('digits'))).equals(all));
        assert.ok((await collect(await read('digits', { start: 0, end: all.length - 1 }))).equals(all));
        assert.equal((await collect(await read('digits', { start: 13, end: 17 }))).toString(), '34567');
        assert.equal(
            (await collect(await read('digits', { start: all.length - 1, end: all.length - 1 }))).toString(),
            '9',
        );
        assert.ok(
            (await collect(await read('digits', { start: 70_000, end: 150_000 }))).equals(
                all.subarray(70_000, 150_001),
            ),
        );
        assert.equal((await collect(await read('empty'))).length, 0);
    });

    test('never delivers a chunk of more than 64 KiB', async () => {
        for await (const chunk of await read('digits')) assert.ok(chunk.length <= 65_536);
    });

    test('rejects before the first byte for a missing file, a folder and a range past the end', async () => {
        await assert.rejects(read('missing'), { code: 'ENOENT' });
        await assert.rejects(read('.'), /is not a regular file/);
        await assert.rejects(read('.', { start: 0, end: 9 }), /is not a regular file/);
        await assert.rejects(read('digits', { start: 0, end: 200_000 }), RangeError);
        await assert.rejects(read('empty', { start: 0, end: 0 }), RangeError);
    });

    test('reads a range past 2 GiB of a sparse file', { skip: !hasProc }, async (t) => {
        write('sparse', Buffer.alloc(0));
        fs.truncateSync(join(folder, 'sparse'), 2 ** 31 + 4096);
        // A file system without holes would have written the 2 GiB: only the others run this test
        if (fs.statSync(join(folder, 'sparse')).blocks * 512 > 64 * 1024 * 1024) return t.skip('no sparse files here');

        const bytes = await collect(await read('sparse', { start: 2 ** 31 - 10, end: 2 ** 31 + 99 }));

        assert.equal(bytes.length, 110);
        assert.ok(bytes.every((byte) => byte === 0));
    });

    test('errors midway when the file is cut while it is read', async () => {
        write('cut', Buffer.alloc(300_000, 1));
        const stream = await read('cut', { start: 0, end: 299_999 });
        const reader = stream.getReader();
        await reader.read();
        fs.truncateSync(join(folder, 'cut'), 70_000);

        assert.equal((await reader.read()).value.length, 70_000 - 65_536, 'a short read delivers what it read');
        await assert.rejects(async () => {
            for (;;) if ((await reader.read()).done) return;
        }, /ended at byte 70000/);
    });

    test(
        'closes its descriptor when the stream ends, is cancelled, fails to start or fails midway',
        { skip: !hasProc },
        async () => {
            const before = descriptors();

            await collect(await read('digits'));
            const cancelled = (await read('digits')).getReader();
            await cancelled.read();
            await cancelled.cancel();
            await read('digits', { start: 0, end: 999_999 }).catch(() => undefined);
            await read('missing').catch(() => undefined);

            write('cut2', Buffer.alloc(300_000, 1));
            const midway = (await read('cut2', { start: 0, end: 299_999 })).getReader();
            await midway.read();
            fs.truncateSync(join(folder, 'cut2'), 10);
            await midway.read().catch(() => undefined);
            await midway.read().catch(() => undefined);

            assert.equal(descriptors(), before);
        },
    );
});
