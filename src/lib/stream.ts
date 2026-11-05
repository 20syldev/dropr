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
