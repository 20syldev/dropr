/**
 * Ranks a UTF-16 code unit so that comparing ranks follows the order of the code points in UTF-8.
 * UTF-16 puts the surrogates, which stand for the code points above U+FFFF, before U+E000 to U+FFFF, while UTF-8
 * puts them after, so the two ranges swap places.
 *
 * @param unit - Code unit of a string
 * @returns The unit itself below the surrogates, 0xD800 plus its offset for 0xE000 and above, 0xF800 plus its offset
 * for a surrogate
 */
function rank(unit: number): number {
    if (unit >= 0xe000) return unit - 0x800;

    return unit >= 0xd800 ? unit + 0x2000 : unit;
}

/**
 * Compares two strings by the bytes of their UTF-8 encoding, which is the order of strcmp and of a Buffer compare.
 * It is the order of every list of the index but the versions, the same on every platform and without a locale, and it
 * needs no Buffer, so the Node-free core can check it.
 *
 * @param a - Well-formed string, such as a file name
 * @param b - Well-formed string
 * @returns Negative if a sorts first, positive if b sorts first, zero only for equal strings
 */
export function compareBytes(a: string, b: string): number {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
        const x = a.charCodeAt(i);
        const y = b.charCodeAt(i);
        if (x !== y) return rank(x) - rank(y);
    }

    return a.length - b.length;
}
