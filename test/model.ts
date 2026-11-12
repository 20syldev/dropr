// Model of RFC 9110 sections 13 and 14 for a GET or HEAD of one file, written apart from src/lib/http.ts to check it

// The request that model() answers: the headers are lower-case, trimmed, and '' or undefined stands for absent
export interface ModelRequest {
    method: string;
    size: number;
    etag: string;
    lm: number;
    h: Record<string, string | undefined>;
}

// The answer of model(): the status and the [first, last] bytes of the body, null when it has none
export interface ModelResult {
    status: number;
    range: [number, number] | null;
}

const MONTHS: Record<string, number | undefined> = {
    Jan: 1,
    Feb: 2,
    Mar: 3,
    Apr: 4,
    May: 5,
    Jun: 6,
    Jul: 7,
    Aug: 8,
    Sep: 9,
    Oct: 10,
    Nov: 11,
    Dec: 12,
};
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const LONG_WEEKDAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

/**
 * Counts the days from 1970-01-01 to a date of the proleptic Gregorian calendar (Howard Hinnant's days_from_civil).
 *
 * @param y - Full year, which may be before 1970
 * @param m - Month from 1 to 12
 * @param d - Day of the month from 1, not checked against the month
 * @returns The number of days, negative before the epoch
 */
function daysFromCivil(y: number, m: number, d: number): number {
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}

/**
 * Tells whether a year has a 29th of February.
 *
 * @param y - Full year of the Gregorian calendar
 * @returns True for a multiple of 4 that is not a multiple of 100, and for a multiple of 400
 */
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/**
 * Gives the number of days of a month.
 *
 * @param y - Full year, which decides February
 * @param m - Month from 1 to 12
 * @returns The length of the month in days
 */
const monthLength = (y: number, m: number): number =>
    [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/**
 * Completes a two-digit RFC 850 year with the candidate that lies in the 50 years before and after the reference.
 * This is the window of RFC 9110 5.6.7, with the reference standing for the clock.
 *
 * @param yy - Two-digit year from 0 to 99
 * @param ref - Time in milliseconds since the epoch whose year the window is centred on
 * @returns The full year
 */
function fullYear(yy: number, ref: number): number {
    const around = new Date(ref).getUTCFullYear();
    const century = around - (around % 100);
    return [century - 100 + yy, century + yy, century + 100 + yy].find(
        (y) => y > around - 50 && y <= around + 50,
    ) as number;
}

/**
 * Reads an HTTP date in the three formats of RFC 9110 as UTC.
 * The day name must be one of the names of the format, but is not checked against the date.
 *
 * @param text - Header value, which must be the whole date and nothing else
 * @param ref - Time in milliseconds since the epoch that a two-digit year is read around
 * @returns Milliseconds since the epoch, or null when the text is no date or names a day the month does not have
 */
export function httpDate(text: string, ref: number): number | null {
    let m: RegExpExecArray | null;
    let day: number, month: number | undefined, year: number, time: string;
    if (
        (m = /^([A-Za-z]{3}), (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(text)) &&
        WEEKDAYS.has(m[1])
    ) {
        [day, month, year, time] = [+m[2], MONTHS[m[3]], +m[4], m[5]];
    } else if (
        (m = /^([A-Za-z]+), (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(text)) &&
        LONG_WEEKDAYS.has(m[1])
    ) {
        [day, month, year, time] = [+m[2], MONTHS[m[3]], fullYear(+m[4], ref), m[5]];
    } else if (
        (m = /^([A-Za-z]{3}) ([A-Za-z]{3}) ( \d|\d{2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/.exec(text)) &&
        WEEKDAYS.has(m[1])
    ) {
        [day, month, year, time] = [+m[3], MONTHS[m[2]], +m[5], m[4]];
    } else {
        return null;
    }
    if (!month || day < 1 || day > monthLength(year, month)) return null;
    const [h, mi, s] = time.split(':').map(Number);
    if (h > 23 || mi > 59 || s > 60) return null;
    return (daysFromCivil(year, month, day) * 86400 + h * 3600 + mi * 60 + s) * 1000;
}

const ELEM = '(?:W/)?"[\\x21\\x23-\\x7e\\x80-\\xff]*"';
const LIST = new RegExp(`^[ \\t,]*(?:${ELEM}(?:[ \\t]*,[ \\t,]*${ELEM})*[ \\t]*(?:,[ \\t,]*)?)?$`);

/**
 * Splits an If-Match or If-None-Match value into its entity tags.
 *
 * @param list - Header value, where spaces and tabs around the tags and empty list elements are allowed
 * @returns Each tag with its weak flag and its quoted opaque part, or null when the value is not a list of entity tags
 */
function tags(list: string): { weak: boolean; opaque: string }[] | null {
    if (!LIST.test(list)) return null;
    return [...list.matchAll(/(W\/)?"[^"]*"/g)].map((m) => ({
        weak: m[1] !== undefined,
        opaque: m[1] ? m[0].slice(2) : m[0],
    }));
}

/**
 * Marks the bytes of a file that a Range header asks for.
 *
 * @param value - Range header value, with the unit in any case
 * @param size - Size of the file in bytes
 * @returns A Uint8Array of size entries holding 1 for each requested byte, 'ignore' when the header is no valid range
 * (another unit, a spec that cannot be read, a last position before the first), or 'unsatisfiable' when no spec
 * reaches a byte of the file
 */
function requested(value: string, size: number): Uint8Array | 'ignore' | 'unsatisfiable' {
    const m = /^[Bb][Yy][Tt][Ee][Ss]=(.*)$/.exec(value);
    if (!m) return 'ignore';
    const parts = m[1].split(',').map((p) => p.replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''));
    const specs = parts.filter((p) => p !== '');
    if (specs.length === 0) return 'ignore';
    const bits = new Uint8Array(size);
    let satisfiable = false;
    for (const spec of specs) {
        const s = /^(\d+)-(\d*)$/.exec(spec);
        const suffix = /^-(\d+)$/.exec(spec);
        if (s) {
            const first = BigInt(s[1]);
            if (s[2] !== '' && BigInt(s[2]) < first) return 'ignore';
            if (first >= BigInt(size)) continue;
            const last =
                s[2] === '' ? BigInt(size - 1) : BigInt(s[2]) < BigInt(size - 1) ? BigInt(s[2]) : BigInt(size - 1);
            for (let i = Number(first); i <= Number(last); i++) bits[i] = 1;
            satisfiable = true;
        } else if (suffix) {
            const n = BigInt(suffix[1]);
            if (n === 0n || size === 0) continue;
            const from = n >= BigInt(size) ? 0 : size - Number(n);
            for (let i = from; i < size; i++) bits[i] = 1;
            satisfiable = true;
        } else {
            return 'ignore';
        }
    }
    return satisfiable ? bits : 'unsatisfiable';
}

/**
 * Tells whether an If-Match value holds for a strong tag.
 *
 * @param v - If-Match value
 * @param etag - Quoted strong tag of the file
 * @returns True for * or a listed tag that is not weak and equals the tag, false for a value that is not a list of tags
 */
const ifMatchHolds = (v: string, etag: string): boolean =>
    v === '*' || (tags(v) ?? []).some((t) => !t.weak && t.opaque === etag);

/**
 * Tells whether an If-None-Match value matches a tag, by weak comparison.
 *
 * @param v - If-None-Match value
 * @param etag - Quoted strong tag of the file
 * @returns True for * or a listed tag, weak or not, whose opaque part equals the tag, false for a value that is not a
 * list of tags
 */
const ifNoneMatchMatches = (v: string, etag: string): boolean =>
    v === '*' || (tags(v) ?? []).some((t) => t.opaque === etag);

/**
 * Tells whether an If-Range value names the current representation.
 *
 * @param v - If-Range value: a tag, which must equal the tag as sent, or an HTTP date
 * @param etag - Quoted strong tag of the file
 * @param lm - Last-Modified of the file in milliseconds since the epoch, which a date must equal to the second
 * @returns True when the tag is the same or the date is the Last-Modified, false for a weak tag and any other value
 */
const ifRangeHolds = (v: string, etag: string, lm: number): boolean => {
    if (/^(W\/)?"/.test(v)) return v === etag;
    const d = httpDate(v, lm);
    return d !== null && d === Math.floor(lm / 1000) * 1000;
};

/**
 * Reads a Range header against a file size as at most one range.
 *
 * @param value - Range header value
 * @param size - Size of the file in bytes
 * @returns 'ignore' or 'unsatisfiable' as requested() says, [first, last] when the requested bytes form one run, or
 * 'many' when they form several runs
 */
function rangeOutcome(value: string, size: number): 'ignore' | 'unsatisfiable' | 'many' | [number, number] {
    const bits = requested(value, size);
    if (bits === 'ignore' || bits === 'unsatisfiable') return bits;
    const on: number[] = [];
    bits.forEach((b, i) => b && on.push(i));
    if (on.length === 0) return 'unsatisfiable';
    return on[on.length - 1] - on[0] + 1 === on.length ? [on[0], on[on.length - 1]] : 'many';
}

/**
 * Answers the request per RFC 9110 13.2.2.
 *
 * @param req - method, size, etag (quoted strong), lm (ms), h (lower-case header map, values trimmed, '' = absent)
 * @returns { status, range } with range = [first, last] of the body or null
 */
export function model({ method, size, etag, lm, h }: ModelRequest): ModelResult {
    const get = (name: string): string | undefined => (h[name] === undefined || h[name] === '' ? undefined : h[name]);
    const modified = Math.floor(lm / 1000) * 1000;
    const whole: [number, number] | null = size > 0 ? [0, size - 1] : null;

    if (get('if-match') !== undefined) {
        if (!ifMatchHolds(get('if-match') as string, etag)) return { status: 412, range: null };
    } else if (get('if-unmodified-since') !== undefined) {
        const d = httpDate(get('if-unmodified-since') as string, lm);
        if (d !== null && modified > d) return { status: 412, range: null };
    }

    if (get('if-none-match') !== undefined) {
        if (ifNoneMatchMatches(get('if-none-match') as string, etag)) return { status: 304, range: null };
    } else if (get('if-modified-since') !== undefined) {
        const d = httpDate(get('if-modified-since') as string, lm);
        if (d !== null && modified <= d) return { status: 304, range: null };
    }

    if (method === 'GET' && get('range') !== undefined) {
        if (get('if-range') === undefined || ifRangeHolds(get('if-range') as string, etag, lm)) {
            const outcome = rangeOutcome(get('range') as string, size);
            if (outcome === 'unsatisfiable') return { status: 416, range: null };
            if (Array.isArray(outcome)) return { status: 206, range: outcome };
        }
    }

    return { status: 200, range: whole };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Pads a number with a leading zero to two digits.
 *
 * @param n - Non-negative integer
 * @returns The two-digit text, longer when n has more digits
 */
const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Writes a time as an IMF-fixdate by hand, so that tests never rely on toUTCString for what they feed to the parser.
 *
 * @param ms - Time in milliseconds since the epoch, a whole number of seconds
 * @returns The date as servers send it, such as Thu, 01 May 2025 00:00:00 GMT
 */
export function imf(ms: number): string {
    const d = new Date(ms);
    const date = `${pad(d.getUTCDate())} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

    const time = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(pad).join(':');

    return `${DAY_NAMES[d.getUTCDay()]}, ${date} ${time} GMT`;
}
