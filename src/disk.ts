import fs from 'fs';
import { join } from 'path';

import type { ByteRange, ReadFile } from './types/index.js';

// Bytes asked from the disk by a pull, the most a download keeps in memory per stream
const CHUNK = 64 * 1024;

/**
 * Builds the read port of the server over a folder of files.
 * The file is opened before anything is returned, so a missing or unreadable one, or one that is not a regular file,
 * rejects before the first byte, and its descriptor is closed when the stream ends, fails or is cancelled.
 *
 * @param root - Absolute folder that every path is relative to
 * @returns The port: it streams the whole file, or the bytes of a range, and rejects with a RangeError when the file
 * is shorter than the end of the range, and with an Error when the path is a folder or another kind of entry
 */
export function createReader(root: string): ReadFile {
    return async (path: string, range?: ByteRange) => {
        const handle = await fs.promises.open(join(root, path), 'r');
        const close = () => handle.close().catch(() => undefined);

        try {
            const stats = await handle.stat();
            if (!stats.isFile()) throw new Error(`${path} is not a regular file`);

            const { size } = stats;
            if (range && range.end >= size) throw new RangeError(`${path} has ${size} bytes, ${range.end + 1} asked`);

            let position = range?.start ?? 0;
            const end = range ? range.end : size - 1;

            return new ReadableStream<Uint8Array<ArrayBuffer>>(
                {
                    async pull(controller) {
                        try {
                            if (position > end) {
                                await close();
                                return controller.close();
                            }

                            const buffer = new Uint8Array(Math.min(CHUNK, end - position + 1));
                            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
                            if (bytesRead === 0) throw new Error(`${path} ended at byte ${position}`);

                            position += bytesRead;
                            controller.enqueue(buffer.subarray(0, bytesRead));
                        } catch (error) {
                            await close();
                            throw error;
                        }
                    },
                    cancel: close,
                },
                { highWaterMark: 0 },
            );
        } catch (error) {
            await close();
            throw error;
        }
    };
}
