/**
 * Builds a seeded random generator, so that a failure of a random test can be replayed.
 *
 * @param seed - Integer that fixes the whole sequence
 * @returns A function that gives the next number from 0 included to 1 excluded
 */
export function mulberry32(seed: number): () => number {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
