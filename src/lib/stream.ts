/**
 * Checks that a byte stream holds exactly a given number of bytes, so that a body never differs from the length
 * announced for it.
 *
 * @param source - Stream to pass on; it is cancelled when the result is cancelled or the source holds too much, so the
 * descriptor behind a port that runs long is released, and a source that ended or failed has nothing left to release
 * @param length - Number of bytes the source must hold
 * @returns The bytes of the source, as they come; it errors when the source ends before the length or holds more
 */
export function exact(
    source: ReadableStream<Uint8Array<ArrayBuffer>>,
    length: number,
): ReadableStream<Uint8Array<ArrayBuffer>> {
    const reader = source.getReader();
    let left = length;

    return new ReadableStream<Uint8Array<ArrayBuffer>>(
        {
            async pull(controller) {
                const { done, value } = await reader.read();
                if (done) {
                    if (left > 0) throw new Error(`The source ended ${left} bytes before the expected ${length}`);

                    return controller.close();
                }
                if (value.length > left) {
                    const error = new Error(`The source holds more than the expected ${length} bytes`);
                    await reader.cancel(error).catch(() => undefined);

                    throw error;
                }

                left -= value.length;
                controller.enqueue(value);
            },
            cancel: (reason) => reader.cancel(reason),
        },
        { highWaterMark: 0 },
    );
}

/**
 * Passes a byte stream on and reports the error that ends it, which a client that left does not cause.
 *
 * @param source - Stream to pass on; it is cancelled when the result is cancelled
 * @param report - Called once with the error that makes the source fail, before the result fails with it too; never
 * called once the result is cancelled, since a client that leaves is not a failure
 * @returns The bytes of the source, as they come
 */
export function watch(
    source: ReadableStream<Uint8Array<ArrayBuffer>>,
    report: (error: Error) => void,
): ReadableStream<Uint8Array<ArrayBuffer>> {
    const reader = source.getReader();
    let cancelled = false;

    return new ReadableStream<Uint8Array<ArrayBuffer>>(
        {
            async pull(controller) {
                try {
                    const { done, value } = await reader.read();

                    // A read still pending when the result was cancelled settles on a stream that is closed already
                    if (cancelled) return;
                    if (done) return controller.close();

                    controller.enqueue(value);
                } catch (error) {
                    if (!cancelled) report(error as Error);

                    throw error;
                }
            },
            cancel(reason) {
                cancelled = true;

                return reader.cancel(reason);
            },
        },
        { highWaterMark: 0 },
    );
}
