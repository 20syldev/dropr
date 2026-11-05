import assert from 'assert/strict';
import { describe, test } from 'node:test';

import { conditionsOf, decide, parseHttpDate } from '../dist/lib/http.js';

import { httpDate, imf, model } from './model.mjs';

// Release day of the files below, 00:00:00 GMT
const LAST_MODIFIED = Date.UTC(2025, 4, 1);
const TAG = `"${'ab'.repeat(32)}"`;

/**
 * Builds the input of decide() from a header map.
 *
 * @param method - GET or HEAD
 * @param headers - Lower case request headers
 * @returns The conditions, an empty value counting as absent as conditionsOf does
 */
function conditions(method, headers = {}) {
    const read = (name) => headers[name] || null;

    return {
        method,
        ifMatch: read('if-match'),
        ifNoneMatch: read('if-none-match'),
        ifModifiedSince: read('if-modified-since'),
        ifUnmodifiedSince: read('if-unmodified-since'),
        ifRange: read('if-range'),
        range: read('range'),
    };
}

/**
 * Decides the answer to a request for a file of the given size.
 *
 * @param headers - Lower case request headers
 * @param size - File size in bytes, 24 by default
 * @param method - GET by default
 * @returns The decision of decide()
 */
function decision(headers, size = 24, method = 'GET') {
    return decide(conditions(method, headers), { etag: TAG, lastModified: LAST_MODIFIED, size });
}

/**
 * Reduces a decision to the pair that the model also gives.
 *
 * @param entry - Decision of decide()
 * @returns The status and the first and last byte of the body, null for no body
 */
function summary({ status, range }) {
    return { status, range: range ? [range.start, range.end] : null };
}

/**
 * Asks the independent model for the same request as decision().
 *
 * @param headers - Lower case request headers
 * @param size - File size in bytes
 * @param method - GET or HEAD
 * @returns The status and body range of the model
 */
function expected(headers, size, method) {
    return model({ method, size, etag: TAG, lm: LAST_MODIFIED, h: headers });
}

describe('parseHttpDate', () => {
    const read = (text, reference = LAST_MODIFIED) => parseHttpDate(text, reference);

    test('reads the three formats of RFC 9110 as UTC', () => {
        const day = Date.UTC(1994, 10, 6, 8, 49, 37);

        assert.equal(read('Sun, 06 Nov 1994 08:49:37 GMT'), day);
        assert.equal(read('Sunday, 06-Nov-94 08:49:37 GMT'), day);
        assert.equal(read('Sun Nov  6 08:49:37 1994'), day);
        assert.equal(read('Sun Nov 06 08:49:37 1994'), day);
    });

    test('reads every month and every weekday name in the three formats', () => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const longDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        months.forEach((month, index) => {
            const at = Date.UTC(2024, index, 15, 1, 2, 3);
            const weekday = new Date(at).getUTCDay();

            assert.equal(read(`${days[weekday]}, 15 ${month} 2024 01:02:03 GMT`), at, month);
            assert.equal(read(`${longDays[weekday]}, 15-${month}-24 01:02:03 GMT`), at, month);
            assert.equal(read(`${days[weekday]} ${month} 15 01:02:03 2024`), at, month);
        });
        days.forEach((day, weekday) => {
            const at = Date.UTC(2024, 5, 2 + weekday);

            assert.equal(read(`${day}, 0${2 + weekday} Jun 2024 00:00:00 GMT`), at, day);
            assert.equal(read(`${longDays[weekday]}, 0${2 + weekday}-Jun-24 00:00:00 GMT`), at, day);
            assert.equal(read(`${day} Jun  ${2 + weekday} 00:00:00 2024`), at, day);
        });
    });

    test('reads a two-digit year in the 50 years around the reference, as RFC 9110 5.6.7 asks without a clock', () => {
        const may = (yy, reference) => read(`Thursday, 01-May-${yy} 00:00:00 GMT`, reference);
        const years = (yy, reference) => new Date(may(yy, reference)).getUTCFullYear();

        assert.equal(may('25'), Date.UTC(2025, 4, 1));
        assert.equal(may('94'), Date.UTC(1994, 4, 1));
        assert.equal([years('75', Date.UTC(2026, 0, 1)), years('76', Date.UTC(2026, 0, 1))].join(), '2075,2076');
        assert.equal([years('77', Date.UTC(2026, 0, 1)), years('00', Date.UTC(2026, 0, 1))].join(), '1977,2000');
        assert.equal([years('00', Date.UTC(2099, 0, 1)), years('49', Date.UTC(2099, 0, 1))].join(), '2100,2149');
        assert.equal([years('50', Date.UTC(2099, 0, 1)), years('51', Date.UTC(2099, 0, 1))].join(), '2050,2051');
        assert.equal([years('70', Date.UTC(1995, 0, 1)), years('45', Date.UTC(1995, 0, 1))].join(), '1970,2045');
    });

    test('refuses a day that does not exist, a time out of range and any other spelling [change: dates]', () => {
        for (const text of [
            'Thu, 30 Feb 2025 00:00:00 GMT',
            'Thu, 29 Feb 2025 00:00:00 GMT',
            'Thu, 31 Apr 2025 00:00:00 GMT',
            'Thu, 00 May 2025 00:00:00 GMT',
            'Thu, 01 May 2025 24:00:00 GMT',
            'Thu, 01 May 2025 00:60:00 GMT',
            'Thu, 01 May 2025 00:00:61 GMT',
            'Thu, 1 May 2025 00:00:00 GMT',
            'Thu, 01 May 2025 00:00:00 UTC',
            'Thu, 01 May 2025 00:00:00 +0000',
            'thu, 01 may 2025 00:00:00 gmt',
            'Thu, 01 May 2025',
            '2025-05-01T00:00:00Z',
            'Thu, 01 May 2025 00:00:00 GMT, Thu, 01 May 2025 00:00:00 GMT',
            '1746057600',
            '',
        ]) {
            assert.equal(read(text), null, text);
        }
    });

    test('accepts 29 February of a leap year, and a leap second as the next second', () => {
        assert.equal(read('Thu, 29 Feb 2024 00:00:00 GMT'), Date.UTC(2024, 1, 29));
        assert.equal(read('Thu, 01 May 2025 00:00:60 GMT'), Date.UTC(2025, 4, 1, 0, 1, 0));
    });

    test('reads the years 0000 to 0099 of the first format as they are written', () => {
        for (let year = 0; year < 100; year++) {
            const first = new Date(0);
            first.setUTCFullYear(year, 0, 1);

            assert.equal(read(`Mon, 01 Jan ${String(year).padStart(4, '0')} 00:00:00 GMT`), first.getTime(), year);
        }
    });

    test('reads every second of a leap day as the model does, and as imf() writes it', () => {
        const start = Date.UTC(2024, 1, 29);
        for (let t = start; t < start + 86_400_000; t += 1000) {
            assert.equal(read(imf(t)), t, imf(t));
            assert.equal(read(imf(t)), httpDate(imf(t), LAST_MODIFIED), imf(t));
        }
    });
});

describe('decide: RFC 9110 section 13.2.2', () => {
    test('an unconditional GET is a 200 for the whole file, with its validators and length', () => {
        const { status, headers, range } = decision({});

        assert.equal(status, 200);
        assert.deepEqual(range, { start: 0, end: 23 });
        assert.deepEqual(headers, {
            ETag: TAG,
            'Last-Modified': 'Thu, 01 May 2025 00:00:00 GMT',
            'Accept-Ranges': 'bytes',
            'Content-Length': '24',
        });
    });

    test('an empty file is a 200 with no body, and every range is unsatisfiable', () => {
        const { status, headers, range } = decision({}, 0);

        assert.deepEqual([status, range, headers['Content-Length']], [200, null, '0']);
        for (const value of ['bytes=0-', 'bytes=0-0', 'bytes=-1', 'bytes=-0', 'bytes=5-9']) {
            assert.deepEqual(summary(decision({ range: value }, 0)), { status: 416, range: null }, value);
        }
        assert.equal(decision({ range: 'bytes=0-' }, 0).headers['Content-Range'], 'bytes */0');
    });

    test('If-Match is evaluated first, with a strong comparison, and its failure is a 412 whatever else is sent [change: match]', () => {
        const stale = { 'if-none-match': TAG, 'if-modified-since': imf(LAST_MODIFIED), range: 'bytes=0-1' };

        assert.equal(decision({ 'if-match': TAG, ...stale }).status, 304);
        assert.equal(decision({ 'if-match': '*', ...stale }).status, 304);
        assert.equal(decision({ 'if-match': `W/${TAG}` }).status, 412);
        assert.equal(decision({ 'if-match': '"other"', ...stale }).status, 412);
        assert.equal(decision({ 'if-match': `"other", ${TAG}` }).status, 200);
        assert.equal(decision({ 'if-match': `${TAG} "other"` }).status, 412, 'a list needs its commas');
        assert.equal(decision({ 'if-match': `*, ${TAG}` }).status, 412, '* stands alone');
    });

    test('If-Unmodified-Since is read only without If-Match, and a date it cannot read is ignored', () => {
        const before = imf(LAST_MODIFIED - 1000);

        assert.equal(decision({ 'if-unmodified-since': before }).status, 412);
        assert.equal(decision({ 'if-unmodified-since': imf(LAST_MODIFIED) }).status, 200);
        assert.equal(decision({ 'if-unmodified-since': before, 'if-match': TAG }).status, 200);
        assert.equal(decision({ 'if-unmodified-since': '2025-04-30T23:59:59Z' }).status, 200);
        assert.equal(decision({ 'if-unmodified-since': 'Wed, 30 Apr 2025 23:59:59 UTC' }).status, 200);
        assert.equal(decision({ 'if-unmodified-since': 'Wed Apr 30 23:59:59 2025' }).status, 412, 'asctime is a date');
    });

    test('If-None-Match is weak, takes a list and *, and hides If-Modified-Since', () => {
        for (const value of [TAG, `W/${TAG}`, `"other", ${TAG}`, '*', `${TAG},`, `,${TAG}`]) {
            assert.equal(decision({ 'if-none-match': value }).status, 304, value);
        }
        for (const value of ['"other"', `${TAG}x`, `${TAG} "other"`, `*, ${TAG}`, 'garbage', `W /${TAG}`]) {
            assert.equal(decision({ 'if-none-match': value }).status, 200, value);
        }
        const old = imf(LAST_MODIFIED + 1000);

        assert.equal(decision({ 'if-none-match': '"other"', 'if-modified-since': old }).status, 200);
        assert.equal(decision({ 'if-modified-since': old }).status, 304);
    });

    test('If-Modified-Since is a 304 when the date is not before Last-Modified', () => {
        assert.equal(decision({ 'if-modified-since': imf(LAST_MODIFIED) }).status, 304);
        assert.equal(decision({ 'if-modified-since': imf(LAST_MODIFIED - 1000) }).status, 200);
        assert.equal(decision({ 'if-modified-since': 'Wed, 30 Apr 2025 23:59:59 GMT' }).status, 200);
        assert.equal(decision({ 'if-modified-since': 'Thursday, 01-May-25 00:00:00 GMT' }).status, 304);
        assert.equal(decision({ 'if-modified-since': 'Thu May  1 00:00:00 2025' }).status, 304);
        assert.equal(decision({ 'if-modified-since': 'May 1, 2025' }).status, 200);
    });

    test('a 304 carries the validators of the 200 and nothing of the body', () => {
        const ok = decision({});
        const { status, headers, range } = decision({ 'if-none-match': TAG });

        assert.deepEqual([status, range], [304, null]);
        assert.deepEqual(headers, { ETag: ok.headers.ETag, 'Last-Modified': ok.headers['Last-Modified'] });
    });

    test('a 412 carries no header of its own', () => {
        assert.deepEqual(decision({ 'if-match': '"other"' }).headers, {});
    });
});

describe('decide: ranges of RFC 9110 section 14', () => {
    const range = (value, size = 24, extra = {}) => decision({ range: value, ...extra }, size);

    test('a byte range is a 206 with its Content-Range and Content-Length', () => {
        const { status, headers, range: body } = range('bytes=2-5');

        assert.equal(status, 206);
        assert.deepEqual(body, { start: 2, end: 5 });
        assert.equal(headers['Content-Range'], 'bytes 2-5/24');
        assert.equal(headers['Content-Length'], '4');
        assert.equal(headers['Accept-Ranges'], 'bytes');
        assert.equal(headers.ETag, TAG);
    });

    test('open, suffix and overlong ranges are cut to the file [change: suffix]', () => {
        assert.deepEqual(summary(range('bytes=20-')), { status: 206, range: [20, 23] });
        assert.deepEqual(summary(range('bytes=0-999')), { status: 206, range: [0, 23] });
        assert.deepEqual(summary(range('bytes=-4')), { status: 206, range: [20, 23] });
        assert.deepEqual(summary(range('bytes=-24')), { status: 206, range: [0, 23] });
        assert.deepEqual(summary(range('bytes=-25')), { status: 206, range: [0, 23] }, 'a suffix longer than the file');
        assert.deepEqual(summary(range(`bytes=-${'9'.repeat(30)}`)), { status: 206, range: [0, 23] });
        assert.deepEqual(summary(range(`bytes=0-${'9'.repeat(30)}`)), { status: 206, range: [0, 23] });
        assert.deepEqual(summary(range('bytes=00-05')), { status: 206, range: [0, 5] });
    });

    test('a range that starts past the end, or a suffix of 0, is a 416 with the size', () => {
        for (const value of ['bytes=24-', 'bytes=24-30', 'bytes=-0', `bytes=${'9'.repeat(30)}-`, 'bytes=30-,40-']) {
            const { status, headers } = range(value);

            assert.equal(status, 416, value);
            assert.deepEqual(headers, { 'Content-Range': 'bytes */24' }, value);
        }
    });

    test('ranges that overlap or touch are merged, and a set that stays split is left to the whole file', () => {
        assert.deepEqual(summary(range('bytes=0-5,3-8')), { status: 206, range: [0, 8] });
        assert.deepEqual(summary(range('bytes=0-1,2-3')), { status: 206, range: [0, 3] });
        assert.deepEqual(summary(range('bytes=2-3,0-1')), { status: 206, range: [0, 3] });
        assert.deepEqual(summary(range('bytes=0-5,999-')), { status: 206, range: [0, 5] });
        assert.deepEqual(summary(range('bytes=0-1,3-4')), { status: 200, range: [0, 23] });
        assert.deepEqual(summary(range('bytes=0-5,10-12')), { status: 200, range: [0, 23] });
    });

    test('a Range that cannot be read is ignored, so are other units and a last position before the first [change: syntax]', () => {
        const whole = { status: 200, range: [0, 23] };
        for (const value of [
            'items=0-5',
            'bytes',
            'bytes=',
            'bytes=,',
            'bytes=abc',
            'bytes=a-b',
            'bytes=0-5-7',
            'bytes=--5',
            'bytes=+1-3',
            'bytes=0x1-5',
            'bytes=0 -5',
            'bytes=0- 5',
            'bytes=0-5abc',
            'bytes=0-5,abc',
            'bytes=5-2',
            'bytes=5-2,0-1',
            'bytes=009-08',
            'bytes=9007199254740993-9007199254740992',
            'bytes=9007199254740993-9007199254740992,1-3',
            'bytes=100000000000000000001-100000000000000000000',
            'bytes=0-5;q=1',
            'bytes=0-5,bytes=7-8',
            '0-5',
        ]) {
            assert.deepEqual(summary(range(value)), whole, value);
        }
    });

    test('positions are compared as numbers of any length, as the model does', () => {
        for (const value of [
            'bytes=009-9',
            'bytes=9007199254740993-9007199254740993',
            'bytes=9007199254740992-9007199254740993',
            'bytes=0-100000000000000000000',
            'bytes=-100000000000000000000',
            `bytes=${'9'.repeat(400)}-${'9'.repeat(399)}8,1-3`,
            `bytes=1-3,${'9'.repeat(400)}-${'9'.repeat(401)}`,
        ]) {
            assert.deepEqual(summary(range(value)), expected({ range: value }, 24, 'GET'), value);
        }
    });

    test('a long run of spaces or tabs in a Range is read in linear time', () => {
        for (const space of [' ', '\t']) {
            const start = performance.now();

            assert.deepEqual(summary(range(`bytes=0-1${space.repeat(200_000)}x`)), { status: 200, range: [0, 23] });
            assert.ok(performance.now() - start < 1000, 'the run is rescanned from every position');
        }
    });

    test('the unit is case-insensitive and empty list elements are skipped', () => {
        assert.deepEqual(summary(range('BYTES=0-5')), { status: 206, range: [0, 5] });
        assert.deepEqual(summary(range('Bytes=0-5')), { status: 206, range: [0, 5] });
        assert.deepEqual(summary(range('bytes=,0-5')), { status: 206, range: [0, 5] });
        assert.deepEqual(summary(range('bytes=0-5,')), { status: 206, range: [0, 5] });
        assert.deepEqual(summary(range('bytes=0-5 , 3-8')), { status: 206, range: [0, 8] });
    });

    test('If-Range keeps the range for the strong tag and the exact date, and drops it for anything else [change: ifrange]', () => {
        const partial = { status: 206, range: [0, 5] };
        const whole = { status: 200, range: [0, 23] };

        assert.deepEqual(summary(range('bytes=0-5', 24, { 'if-range': TAG })), partial);
        assert.deepEqual(summary(range('bytes=0-5', 24, { 'if-range': imf(LAST_MODIFIED) })), partial);
        assert.deepEqual(summary(range('bytes=0-5', 24, { 'if-range': 'Thu May  1 00:00:00 2025' })), partial);
        for (const value of [
            `W/${TAG}`,
            '"other"',
            `${TAG}, "other"`,
            `"other", ${TAG}`,
            imf(LAST_MODIFIED + 1000),
            imf(LAST_MODIFIED - 1000),
            '2025-05-01',
            'garbage',
            '*',
        ]) {
            assert.deepEqual(summary(range('bytes=0-5', 24, { 'if-range': value })), whole, value);
        }
    });

    test('If-Range stale also hides an unsatisfiable Range, and without Range it does nothing', () => {
        assert.equal(range('bytes=99-', 24, { 'if-range': '"other"' }).status, 200);
        assert.equal(range('bytes=99-', 24, { 'if-range': TAG }).status, 416);
        assert.deepEqual(summary(decision({ 'if-range': '"other"' })), { status: 200, range: [0, 23] });
    });

    test('a conditional answer wins over a range', () => {
        assert.equal(range('bytes=0-5', 24, { 'if-none-match': TAG }).status, 304);
        assert.equal(range('bytes=0-5', 24, { 'if-match': '"other"' }).status, 412);
    });
});

describe('decide: HEAD', () => {
    test('answers as GET would without Range and If-Range, conditions included [change: head]', () => {
        for (const headers of [
            {},
            { range: 'bytes=0-5' },
            { range: 'bytes=99-' },
            { range: 'bytes=0-5', 'if-range': TAG },
            { 'if-none-match': TAG },
            { 'if-match': '"other"' },
            { 'if-modified-since': imf(LAST_MODIFIED) },
        ]) {
            const plain = Object.fromEntries(
                Object.entries(headers).filter(([name]) => !['range', 'if-range'].includes(name)),
            );

            assert.deepEqual(decision(headers, 24, 'HEAD'), decision(plain, 24, 'GET'), JSON.stringify(headers));
        }
    });

    test('a method other than GET is read as HEAD, so it never takes a range', () => {
        assert.equal(decision({ range: 'bytes=0-5' }, 24, 'POST').status, 200);
    });
});

describe('conditionsOf', () => {
    test('reads the six fields, null for an absent or empty one, a repeated header joined by a comma', () => {
        const headers = new Headers({ range: 'bytes=0-1', 'if-match': '', 'if-none-match': 'a' });
        headers.append('if-none-match', 'b');

        assert.deepEqual(conditionsOf({ method: 'GET', headers }), {
            method: 'GET',
            ifMatch: null,
            ifNoneMatch: 'a, b',
            ifModifiedSince: null,
            ifUnmodifiedSince: null,
            ifRange: null,
            range: 'bytes=0-1',
        });
    });
});

describe('decide against the independent model of RFC 9110', () => {
    // Values of each header, the interesting spellings of the grammar first
    const TAGS = [
        TAG,
        `W/${TAG}`,
        '"other"',
        '*',
        `"other", ${TAG}`,
        `${TAG},"other"`,
        `*, ${TAG}`,
        `${TAG} "other"`,
        `${TAG}x`,
        `"a,b", ${TAG}`,
        `,${TAG},`,
        ',',
        'garbage',
        `w/${TAG}`,
        TAG.slice(1, -1),
    ];
    const DATES = [
        imf(LAST_MODIFIED),
        imf(LAST_MODIFIED - 1000),
        imf(LAST_MODIFIED + 1000),
        'Thursday, 01-May-25 00:00:00 GMT',
        'Thu May  1 00:00:00 2025',
        '2025-05-01',
        'garbage',
        'Thu, 01 May 2025 24:00:00 GMT',
    ];
    const RANGES = [
        'bytes=0-0',
        'bytes=0-5',
        'bytes=3-',
        'bytes=-3',
        'bytes=-0',
        'bytes=5-2',
        'bytes=99-',
        'bytes=-99',
        'bytes=0-1,3-4',
        'bytes=0-1,2-3',
        'bytes=0-5,99-',
        'BYTES=0-5',
        'bytes=0-5,',
        'bytes=a',
        'items=0-5',
    ];

    test('agree on every single header and every pair of headers, for four sizes and both methods', () => {
        const fields = {
            'if-match': TAGS,
            'if-none-match': TAGS,
            'if-range': [...TAGS, ...DATES],
            'if-modified-since': DATES,
            'if-unmodified-since': DATES,
            range: RANGES,
        };
        const names = Object.keys(fields);
        let checked = 0;

        for (const size of [0, 1, 24, 1000]) {
            for (const method of ['GET', 'HEAD']) {
                const requests = [{}];
                for (const [i, a] of names.entries()) {
                    for (const x of fields[a]) {
                        requests.push({ [a]: x });
                        for (const b of names.slice(i + 1))
                            for (const y of fields[b]) requests.push({ [a]: x, [b]: y });
                    }
                }
                for (const headers of requests) {
                    assert.deepEqual(
                        summary(decision(headers, size, method)),
                        expected(headers, size, method),
                        `${method} ${size} ${JSON.stringify(headers)}`,
                    );
                    checked++;
                }
            }
        }
        assert.ok(checked > 20_000, `${checked} requests`);
    });

    test('agree on every Range of up to three specs over the positions around a small file', () => {
        const specs = ['-0'];
        for (let n = 1; n <= 7; n++) specs.push(`-${n}`);
        for (let first = 0; first <= 7; first++) {
            specs.push(`${first}-`);
            for (let last = 0; last <= 7; last++) specs.push(`${first}-${last}`);
        }
        let checked = 0;

        for (const size of [0, 1, 2, 3, 5]) {
            const sets = [...specs.map((a) => [a])];
            for (const a of specs) for (const b of specs) sets.push([a, b]);
            for (const a of specs.filter((_, i) => i % 3 === 0)) {
                for (const b of specs.filter((_, i) => i % 3 === 1)) {
                    for (const c of specs.filter((_, i) => i % 3 === 2)) sets.push([a, b, c]);
                }
            }
            for (const set of sets) {
                const headers = { range: `bytes=${set.join(',')}` };

                assert.deepEqual(
                    summary(decision(headers, size)),
                    expected(headers, size, 'GET'),
                    `${size} ${headers.range}`,
                );
                checked++;
            }
        }
        assert.ok(checked > 20_000, `${checked} ranges`);
    });

    test('agree on random strings for every header', () => {
        let seed = 12345;
        const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
        const alphabet = [
            '"',
            'W/',
            ',',
            ' ',
            '*',
            'a',
            TAG,
            imf(LAST_MODIFIED),
            'bytes=',
            '-',
            '0',
            '5',
            '99',
            ';',
            '\t',
        ];
        const text = () =>
            Array.from({ length: Math.floor(next() * 6) }, () => alphabet[Math.floor(next() * alphabet.length)]).join(
                '',
            );

        for (let i = 0; i < 30_000; i++) {
            const headers = {};
            for (const name of [
                'if-match',
                'if-none-match',
                'if-range',
                'if-modified-since',
                'if-unmodified-since',
                'range',
            ]) {
                if (next() < 0.5) headers[name] = text().replace(/^[ \t]+|[ \t]+$/g, '');
            }
            const size = [0, 1, 24][Math.floor(next() * 3)];
            const method = next() < 0.3 ? 'HEAD' : 'GET';

            assert.deepEqual(
                summary(decision(headers, size, method)),
                expected(headers, size, method),
                JSON.stringify(headers),
            );
        }
    });
});

describe('decide: properties', () => {
    const RANGES = [
        'bytes=0-0',
        'bytes=2-9',
        'bytes=-5',
        'bytes=7-',
        'bytes=0-3,2-9',
        'bytes=1-2,5-6',
        'bytes=40-',
        'bytes=9-3',
    ];

    test('a 206 holds in the file, its Content-Length is its length and its Content-Range names it', () => {
        for (const size of [1, 2, 24, 1000]) {
            for (const value of RANGES) {
                const { status, headers, range } = decision({ range: value }, size);
                if (status !== 206) continue;

                assert.ok(0 <= range.start && range.start <= range.end && range.end < size, `${size} ${value}`);
                assert.equal(headers['Content-Length'], String(range.end - range.start + 1));
                assert.equal(headers['Content-Range'], `bytes ${range.start}-${range.end}/${size}`);
            }
        }
    });

    test('a 200 is the whole file, its Content-Length is the size, and a 304, 412 or 416 has no body', () => {
        for (const size of [0, 1, 24]) {
            const ok = decision({}, size);
            assert.deepEqual(ok.range, size > 0 ? { start: 0, end: size - 1 } : null);
            assert.equal(ok.headers['Content-Length'], String(size));
        }
        for (const headers of [{ 'if-none-match': TAG }, { 'if-match': '"x"' }, { range: 'bytes=99-' }]) {
            const { status, range, headers: sent } = decision(headers);

            assert.ok([304, 412, 416].includes(status));
            assert.equal(range, null);
            assert.equal(sent['Content-Length'], undefined);
        }
    });

    test('the ranges asked for tile the file: the bytes of a 206 are exactly the union of the satisfiable specs', () => {
        const size = 12;
        for (const value of ['bytes=0-3,2-5', 'bytes=0-3,4-7', 'bytes=-4,0-7', 'bytes=8-,6-9', 'bytes=0-3,5-6,4-4']) {
            const { status, range } = decision({ range: value }, size);
            const wanted = new Set();
            for (const spec of value.slice(6).split(',')) {
                const [a, b] = spec.split('-');
                const start = a === '' ? Math.max(0, size - Number(b)) : Number(a);
                const end = a === '' || b === '' ? size - 1 : Math.min(Number(b), size - 1);
                for (let i = start; i <= end; i++) wanted.add(i);
            }
            const sorted = [...wanted].sort((x, y) => x - y);
            const contiguous = sorted.length === sorted[sorted.length - 1] - sorted[0] + 1;

            assert.equal(status, contiguous ? 206 : 200, value);
            if (status === 206)
                assert.deepEqual([range.start, range.end], [sorted[0], sorted[sorted.length - 1]], value);
        }
    });

    test('never throws, whatever the headers hold', () => {
        const junk = [
            '',
            ' ',
            '\u0000',
            '\uffff',
            '"',
            'W/"',
            '"'.repeat(5000),
            ','.repeat(5000),
            'bytes=' + '0-1,'.repeat(5000),
            '9'.repeat(5000),
        ];
        for (const a of junk) {
            for (const b of junk) {
                const headers = { range: a, 'if-range': b, 'if-match': b, 'if-none-match': a, 'if-modified-since': b };

                assert.ok([200, 206, 304, 412, 416].includes(decision(headers).status));
            }
        }
    });
});
