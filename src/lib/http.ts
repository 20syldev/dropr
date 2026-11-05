import type { ByteRange, Conditions, Decision, RouteInput, Validators } from '../types/index.js';

type Ranges = 'ignore' | 'unsatisfiable' | ByteRange[];

// Day and month names of an HTTP date, which RFC 9110 spells in one case only
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TIME = '(?<hour>\\d\\d):(?<minute>\\d\\d):(?<second>\\d\\d)';
const DATES = [
    new RegExp(`^(?:${DAYS.join('|')}), (?<day>\\d\\d) (?<month>${MONTHS.join('|')}) (?<year>\\d{4}) ${TIME} GMT$`),
    new RegExp(
        `^(?:${LONG_DAYS.join('|')}), (?<day>\\d\\d)-(?<month>${MONTHS.join('|')})-(?<year>\\d\\d) ${TIME} GMT$`,
    ),
    new RegExp(`^(?:${DAYS.join('|')}) (?<month>${MONTHS.join('|')}) (?<day> \\d|\\d\\d) ${TIME} (?<year>\\d{4})$`),
];

// Characters an opaque tag may hold between its quotes: everything but controls, space, DEL and the quote
const ETAG_CHARS = /^[\x21\x23-\x7e\x80-\xff]*$/;

const OWS = new Set([' ', '\t']);

/**
 * Reads an HTTP date in any of the three formats of RFC 9110, always as UTC.
 * The day name is not checked against the date. A two-digit year of the obsolete RFC 850 form is read in the 50 years
 * before and after the reference (section 5.6.7), which stands for the clock so that no clock is read.
 *
 * @param text - Header value, which must be the whole date and nothing else
 * @param reference - Time in milliseconds since the epoch that a two-digit year is read around
 * @returns Milliseconds since the epoch, a whole number of seconds, or null when the text is no date or names a day
 * that does not exist
 */
export function parseHttpDate(text: string, reference: number): number | null {
    const fields = DATES.map((date) => date.exec(text)?.groups).find((groups) => groups !== undefined);
    if (!fields) return null;

    const { month, hour, minute, second } = fields;
    const day = Number(fields.day);
    const monthIndex = MONTHS.indexOf(month);
    let year = Number(fields.year);
    if (fields.year.length === 2) {
        const around = new Date(reference).getUTCFullYear();
        year += around - (around % 100);
        if (year > around + 50) year -= 100;
        else if (year <= around - 50) year += 100;
    }

    // A day the month does not have rolls over into the next one, so the day of the date moves
    const calendar = new Date(0);
    calendar.setUTCFullYear(year, monthIndex, day);
    if (calendar.getUTCDate() !== day) return null;
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 60) return null;

    return calendar.getTime() + ((Number(hour) * 60 + Number(minute)) * 60 + Number(second)) * 1000;
}

/**
 * Reads the entity tags of an If-Match or If-None-Match value, which must be a list of them and nothing else.
 * A tag is an optional W/ and a quoted opaque string; tags are separated by commas, which spaces, tabs and empty list
 * elements may surround.
 *
 * @param list - Header value
 * @returns The tags, each with its opaque string, quotes included, and its weakness; null when anything in the value
 * is not a tag, so that a list that is half understood never matches
 */
function entityTags(list: string): { opaque: string; weak: boolean }[] | null {
    const tags: { opaque: string; weak: boolean }[] = [];
    let at = 0;
    let separated = true;

    for (;;) {
        while (at < list.length && OWS.has(list[at])) at++;
        if (at === list.length) return tags;
        if (list[at] === ',') {
            at++;
            separated = true;
            continue;
        }

        const weak = list.startsWith('W/', at);
        const open = at + (weak ? 2 : 0);
        const close = list.indexOf('"', open + 1);
        if (!separated || list[open] !== '"' || close === -1 || !ETAG_CHARS.test(list.slice(open + 1, close))) {
            return null;
        }

        tags.push({ opaque: list.slice(open, close + 1), weak });
        at = close + 1;
        separated = false;
    }
}

/**
 * Evaluates If-Match, which compares strongly: a weak tag never matches.
 *
 * @param list - Header value, a list of entity tags or *
 * @param etag - Current strong entity tag of the file, quotes included
 * @returns True when the value is * or lists the tag
 */
function matchesStrongly(list: string, etag: string): boolean {
    return list === '*' || (entityTags(list) ?? []).some((tag) => !tag.weak && tag.opaque === etag);
}

/**
 * Evaluates If-None-Match, which compares weakly: a W/ in front of the tag does not matter.
 *
 * @param list - Header value, a list of entity tags or *
 * @param etag - Current strong entity tag of the file, quotes included
 * @returns True when the value is * or lists the tag
 */
function matchesWeakly(list: string, etag: string): boolean {
    return list === '*' || (entityTags(list) ?? []).some((tag) => tag.opaque === etag);
}

/**
 * Evaluates If-Range, whose entity tag compares strongly and whose date must be the one of Last-Modified exactly.
 *
 * @param value - Header value: one entity tag or one HTTP date, null when the header is absent
 * @param file - Validators of the file
 * @returns True when there is no If-Range or it names the current version of the file; false for a weak tag, a list, a
 * date that differs, or any text that is neither a tag nor a date
 */
function isCurrent(value: string | null, file: Validators): boolean {
    if (value === null) return true;

    return (
        value === file.etag || parseHttpDate(value, file.lastModified) === Math.floor(file.lastModified / 1000) * 1000
    );
}

/**
 * Removes the spaces and tabs around a text, in one pass from each end.
 * A regular expression that ends in $ would scan a long run of them again from every position.
 *
 * @param text - Any text, such as a header value of up to 16 KiB
 * @returns The text without its leading and trailing spaces and tabs
 */
function trimOws(text: string): string {
    let start = 0;
    let end = text.length;
    while (start < end && OWS.has(text[start])) start++;
    while (end > start && OWS.has(text[end - 1])) end--;

    return text.slice(start, end);
}

/**
 * Compares two numbers written in digits, whatever their length, which Number() cannot do past 2^53.
 *
 * @param a - Digits, possibly with leading zeros
 * @param b - Digits, possibly with leading zeros
 * @returns True when the number a is smaller than the number b
 */
function isBelow(a: string, b: string): boolean {
    const x = a.replace(/^0+/, '');
    const y = b.replace(/^0+/, '');

    return x.length === y.length ? x < y : x.length < y.length;
}

/**
 * Reads one byte range spec of a Range header.
 *
 * @param spec - Text between two commas, without its spaces
 * @returns The first and last position, last being null when open and first null for a suffix; null when it is not
 * of the form first-last, first- or -length, or when its last position is before its first
 */
function parseSpec(spec: string): { first: number | null; last: number | null } | null {
    const match = /^(\d*)-(\d*)$/.exec(spec);
    if (!match || (match[1] === '' && match[2] === '')) return null;
    if (match[1] !== '' && match[2] !== '' && isBelow(match[2], match[1])) return null;

    return {
        first: match[1] === '' ? null : Number(match[1]),
        last: match[2] === '' ? null : Number(match[2]),
    };
}

/**
 * Reads a Range header against the size of a file, per RFC 9110 section 14.
 * Specs that start past the end are dropped, a last position past the end is cut, a suffix longer than the file gives
 * the whole file, overlapping or adjacent ranges are merged, and the merge must leave a single range: a set of
 * several is left to the full answer, which a server may always give.
 *
 * @param value - Range header value
 * @param size - Size of the file in bytes
 * @returns 'ignore' for a unit other than bytes, a syntax error or a spec whose last position is before its first;
 * 'unsatisfiable' when no spec can be served, always for an empty file; else the merged ranges, sorted
 */
function parseRange(value: string, size: number): Ranges {
    const unit = /^bytes=/i.exec(value);
    if (!unit) return 'ignore';

    const specs = value
        .slice(unit[0].length)
        .split(',')
        .map(trimOws)
        .filter((spec) => spec !== '');
    if (specs.length === 0) return 'ignore';

    const ranges: ByteRange[] = [];
    for (const text of specs) {
        const spec = parseSpec(text);
        if (!spec) return 'ignore';

        const { first, last } = spec;
        if (first === null) {
            if (last !== null && last > 0 && size > 0) ranges.push({ start: Math.max(0, size - last), end: size - 1 });
        } else if (first < size) {
            ranges.push({ start: first, end: Math.min(last ?? size, size - 1) });
        }
    }
    if (ranges.length === 0) return 'unsatisfiable';

    const merged: ByteRange[] = [];
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
        const previous = merged[merged.length - 1];
        if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
        else merged.push({ ...range });
    }

    return merged;
}

/**
 * Reads the fields that decide() needs from a request.
 *
 * @param request - Method and headers of the request, whose headers already hold one value per name
 * @returns The method and the conditional and range fields, null for a field that is absent or empty
 */
export function conditionsOf(request: Pick<RouteInput, 'method' | 'headers'>): Conditions {
    const read = (name: string) => request.headers.get(name) || null;

    return {
        method: request.method,
        ifMatch: read('if-match'),
        ifNoneMatch: read('if-none-match'),
        ifModifiedSince: read('if-modified-since'),
        ifUnmodifiedSince: read('if-unmodified-since'),
        ifRange: read('if-range'),
        range: read('range'),
    };
}

/**
 * Decides how to answer a request for a file whose validators are known, from its conditional and range headers.
 * It follows the order of RFC 9110 section 13.2.2: If-Match, else If-Unmodified-Since, then If-None-Match, else
 * If-Modified-Since, then Range with its If-Range. A header that cannot be read, such as a date in a wrong format, is
 * ignored; a Range is ignored for HEAD, which answers as GET would without it.
 *
 * @param request - Method and the fields of the request, null for an absent one; only GET is read for its Range, and
 * any method other than GET is answered as HEAD
 * @param file - Strong entity tag, Last-Modified and size of the file, which the caller read from the index
 * @returns The status, the headers that go with it (validators, Accept-Ranges, Content-Range, Content-Length) and the
 * bytes of the body: the whole file for 200, the range for 206, none otherwise and for an empty file
 */
export function decide(request: Conditions, file: Validators): Decision {
    const { size } = file;
    const modified = Math.floor(file.lastModified / 1000) * 1000;
    const validators = { ETag: file.etag, 'Last-Modified': new Date(modified).toUTCString() };
    const body = (range: ByteRange | null) => (range ? range.end - range.start + 1 : 0);
    const refuse = (status: 412 | 416, headers: Record<string, string> = {}): Decision => ({
        status,
        headers,
        range: null,
    });

    if (request.ifMatch !== null) {
        if (!matchesStrongly(request.ifMatch, file.etag)) return refuse(412);
    } else if (request.ifUnmodifiedSince !== null) {
        const since = parseHttpDate(request.ifUnmodifiedSince, file.lastModified);
        if (since !== null && modified > since) return refuse(412);
    }

    if (request.ifNoneMatch !== null) {
        if (matchesWeakly(request.ifNoneMatch, file.etag)) return { status: 304, headers: validators, range: null };
    } else if (request.ifModifiedSince !== null) {
        const since = parseHttpDate(request.ifModifiedSince, file.lastModified);
        if (since !== null && modified <= since) return { status: 304, headers: validators, range: null };
    }

    const whole = size > 0 ? { start: 0, end: size - 1 } : null;
    const ranges =
        request.method === 'GET' && request.range !== null && isCurrent(request.ifRange, file)
            ? parseRange(request.range, size)
            : 'ignore';
    if (ranges === 'unsatisfiable') return refuse(416, { 'Content-Range': `bytes */${size}` });

    const only = ranges !== 'ignore' && ranges.length === 1 ? ranges[0] : null;
    if (only) {
        const headers = {
            ...validators,
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${only.start}-${only.end}/${size}`,
            'Content-Length': String(body(only)),
        };

        return { status: 206, headers, range: only };
    }

    const headers = { ...validators, 'Accept-Ranges': 'bytes', 'Content-Length': String(body(whole)) };

    return { status: 200, headers, range: whole };
}
