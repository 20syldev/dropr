// Numbers and numeric tag identifiers have no leading zero, other tag identifiers hold ASCII letters, digits and hyphens
const NUMBER = '(?:0|[1-9]\\d*)';
const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';

// The names of version folders that the server indexes: semver.org's X.Y.Z or X.Y.Z-tag, without build metadata
const VERSION = new RegExp(`^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`);

const NUMERIC = /^\d+$/;

/**
 * Tells whether a text is a version name that the server indexes.
 * Only the exact spelling counts, so that two folders never name the same version: a leading v, a missing segment,
 * a leading zero and build metadata are all refused, and so are latest and any name holding an '@'.
 *
 * @param text - Candidate name, such as a folder name inside a project
 * @returns True for X.Y.Z or X.Y.Z-tag as semver.org writes them, with any number of digits
 */
export function isVersion(text: string): boolean {
    return VERSION.test(text);
}

/**
 * Tells whether a version is a release rather than a pre-release.
 *
 * @param version - Name that isVersion accepts
 * @returns True when the name has no tag, since the hyphen only appears after the numbers
 */
export function isRelease(version: string): boolean {
    return !version.includes('-');
}

/**
 * Compares two decimal numbers written without a leading zero.
 *
 * @param a - Digits only, so a longer text is a larger number whatever its digits
 * @param b - Digits only
 * @returns Negative if a < b, positive if a > b, zero if equal, however many digits they have
 */
function compareNumbers(a: string, b: string): number {
    if (a.length !== b.length) return a.length - b.length;

    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compares two tag identifiers by semver precedence.
 *
 * @param a - Identifier of a tag, between two dots
 * @param b - Identifier of another tag
 * @returns Negative if a is lower, positive if higher, zero if equal; numbers compare as numbers and rank below any
 * other identifier, which compares by ASCII
 */
function compareIdentifiers(a: string, b: string): number {
    const aNumber = NUMERIC.test(a);
    const bNumber = NUMERIC.test(b);
    if (aNumber && bNumber) return compareNumbers(a, b);
    if (aNumber !== bNumber) return aNumber ? -1 : 1;

    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compares two version names by semver precedence, which is how a project lists its versions and picks the newest.
 * A tag ranks its version below the release (6.0.0-pre < 6.0.0), and a tag that is a prefix of another is the lower.
 *
 * @param a - Name that isVersion accepts, anything else throws
 * @param b - Name that isVersion accepts
 * @returns Negative if a < b, positive if a > b, zero only for the same name
 */
export function compareVersions(a: string, b: string): number {
    const left = VERSION.exec(a);
    const right = VERSION.exec(b);
    if (!left || !right) throw new TypeError(`${left ? b : a} is not a version name`);

    for (let i = 1; i <= 3; i++) {
        const order = compareNumbers(left[i], right[i]);
        if (order !== 0) return order;
    }
    if (left[4] === undefined || right[4] === undefined) {
        return left[4] === right[4] ? 0 : left[4] === undefined ? 1 : -1;
    }

    const aTag = left[4].split('.');
    const bTag = right[4].split('.');
    for (let i = 0; i < Math.min(aTag.length, bTag.length); i++) {
        const order = compareIdentifiers(aTag[i], bTag[i]);
        if (order !== 0) return order;
    }

    return aTag.length - bTag.length;
}
