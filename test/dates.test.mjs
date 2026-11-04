import assert from 'assert/strict';
import { describe, test } from 'node:test';

import { parseDay } from '../dist/lib/dates.js';
import { parseDeprecation } from '../dist/lib/deprecations.js';
import { isVersionName } from '../dist/lib/packages.js';

describe('parseDay', () => {
    test('reads a real YYYY-MM-DD day as 00:00:00 UTC', () => {
        assert.equal(parseDay('2025-05-01'), Date.UTC(2025, 4, 1));
        assert.equal(parseDay('2024-02-29'), Date.UTC(2024, 1, 29));
        assert.equal(parseDay('1970-01-01'), 0);
        assert.equal(parseDay('1969-12-31'), -86_400_000);
    });

    test('refuses every other spelling and every impossible day', () => {
        const refused = [
            '',
            'not a date',
            '2025-1-1',
            '2025-01-01T12:00:00Z',
            ' 2025-01-01',
            '2025-01-01 ',
            '2025-13-01',
            '2025-00-10',
            '2025-02-30',
            '2025-02-29',
            '2025-04-31',
            '0099-01-01',
            '\uff12\uff10\uff12\uff15-01-01',
            'March 7',
        ];

        for (const text of refused) assert.equal(parseDay(text), null, JSON.stringify(text));
    });
});

describe('parseDeprecation', () => {
    const notice = { date: '2026-10-17', message: 'Renamed to moxon.', successor: '/npm/moxon' };

    test('keeps the date, the message and the successor of a safe notice, and nothing else', () => {
        assert.deepEqual(parseDeprecation({ ...notice, extra: 1 }), notice);
        assert.deepEqual(parseDeprecation({ ...notice, successor: 'https://dropr.sylvain.sh/npm/moxon?a=b#c' }), {
            ...notice,
            successor: 'https://dropr.sylvain.sh/npm/moxon?a=b#c',
        });
        assert.ok(parseDeprecation({ ...notice, date: 'Oct 17 2026' }), 'the date keeps every form Date.parse reads');
        assert.ok(parseDeprecation({ ...notice, date: '2999-01-01' }), 'a deprecation may announce a future date');
    });

    test('refuses what would break a header or a shape', () => {
        const refused = [
            null,
            [],
            'text',
            {},
            { ...notice, date: 'not a date' },
            { ...notice, date: 1 },
            { ...notice, message: 1 },
            { ...notice, successor: '' },
            { ...notice, successor: '/npm/x\r\nSet-Cookie: a=b' },
            { ...notice, successor: '/npm/\u20ac' },
            { ...notice, successor: '/npm/\u00e9' },
            { ...notice, successor: '/npm/a b' },
            { ...notice, successor: '/npm/x>; rel="evil"' },
            { ...notice, successor: '<>' },
        ];

        for (const value of refused) assert.equal(parseDeprecation(value), null, JSON.stringify(value));
    });
});

describe('folder names', () => {
    test('a version folder is anything but latest and a name holding an @', () => {
        for (const name of ['1.0.0', '2.0.0-pre', 'v1.0.0', '1.0', 'abc', '.git', '1.0.0+build', 'LATEST']) {
            assert.equal(isVersionName(name), true, name);
        }
        for (const name of ['latest', '1.0.0@beta', '@', 'a@b']) assert.equal(isVersionName(name), false, name);
    });
});
