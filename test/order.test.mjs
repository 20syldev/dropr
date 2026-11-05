import assert from 'assert/strict';
import { describe, test } from 'node:test';

import { compareBytes } from '../dist/lib/order.js';

// Code units around the edges of UTF-8: one, two and three bytes, the surrogate gap, and four bytes
const UNITS = [
    'a',
    'B',
    '/',
    '.',
    '0',
    '\u00e9',
    '\u07ff',
    '\u0800',
    '\ud7ff',
    '\ue000',
    '\uff5e',
    '\uffff',
    '\u{10000}',
    '\u{1f600}',
];

describe('compareBytes', () => {
    test('orders by the bytes of UTF-8, which is not the order of a string compare', () => {
        const names = ['\u{1f600}', '\uff5e', '\u00e9', 'b', 'a', 'B', '10', '9', ''];
        const bytes = [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

        assert.deepEqual([...names].sort(compareBytes), bytes);
        assert.deepEqual(bytes.slice(0, 4), ['', '10', '9', 'B']);
        assert.ok(compareBytes('\u{1f600}', '\uff5e') > 0, 'a character above U+FFFF sorts after U+FF5E');
        assert.ok('\u{1f600}' < '\uff5e', 'while a string compare says the opposite');
    });

    test('puts a prefix first and equal strings together', () => {
        assert.ok(compareBytes('ab', 'abc') < 0);
        assert.ok(compareBytes('abc', 'ab') > 0);
        assert.equal(compareBytes('dist', 'dist'), 0);
        assert.ok(compareBytes('dist/v3', 'dist/v3.js') < 0, 'a folder sorts before a name that starts with it');
    });

    test('agrees with Buffer.compare on 20000 seeded random pairs', () => {
        let seed = 42;
        const next = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
        const text = () => Array.from({ length: next(5) }, () => UNITS[next(UNITS.length)]).join('');

        for (let i = 0; i < 20_000; i++) {
            const [a, b] = [text(), text()];
            const expected = Math.sign(Buffer.compare(Buffer.from(a), Buffer.from(b)));

            assert.equal(Math.sign(compareBytes(a, b)), expected, JSON.stringify([a, b]));
        }
    });
});
