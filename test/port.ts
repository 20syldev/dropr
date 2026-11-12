import type { ByteRange, ReadFile } from '../dist/types/index.js';

/**
 * Streams bytes in chunks, as a read port does.
 *
 * @param bytes - Content of the stream
 * @param size - Chunk length, 5 bytes by default so that a read crosses many chunks
 * @returns A byte stream that ends after the last chunk
 */
export function chunked(bytes: Uint8Array, size = 5): ReadableStream<Uint8Array<ArrayBuffer>> {
    let at = 0;

    return new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(controller) {
            if (at >= bytes.length) return controller.close();

            controller.enqueue(new Uint8Array(bytes.subarray(at, at + size)));
            at += size;
        },
    });
}

/**
 * Builds a read port over files held in memory, which honours a range as the disk port does.
 *
 * @param read - Function giving the Buffer of a path, or throwing for a missing one
 * @param options - size, the chunk length given to chunked()
 * @returns The port, which rejects with a RangeError for a range past the end of the file
 */
export function memoryPort(read: (path: string) => Uint8Array, { size }: { size?: number } = {}): ReadFile {
    return async (path: string, range?: ByteRange) => {
        const bytes = read(path);
        if (range && range.end >= bytes.length) throw new RangeError(`${path} has ${bytes.length} bytes`);

        return chunked(range ? bytes.subarray(range.start, range.end + 1) : bytes, size);
    };
}

/**
 * Waits until a condition holds, for a cancel that travels through several streams in as many ticks.
 *
 * @param check - Function that returns true once the condition holds
 * @param limit - Longest wait in milliseconds, 5 seconds by default, so that a loaded machine does not fail it
 * @returns True when the condition held in time, false otherwise
 */
export async function eventually(check: () => boolean, limit = 5000): Promise<boolean> {
    const end = Date.now() + limit;
    while (!check()) {
        if (Date.now() > end) return false;

        await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return true;
}
