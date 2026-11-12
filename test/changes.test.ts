import assert from 'assert/strict';
import fs from 'fs';
import { describe, test } from 'node:test';
import { join } from 'path';

import { caseName, CASES } from './cases.ts';
import { CHANGES } from './changes.ts';
import { rootDir } from './server.ts';

const ids = CHANGES.map(({ id }) => id);

describe('changes ledger', () => {
    test('every id is unique and every decision is settled', () => {
        assert.deepEqual([...new Set(ids)], ids);
        for (const { id, decision } of CHANGES) assert.ok(['keep', 'change'].includes(decision), `${id} is pending`);
    });

    test('every note is one line of ASCII that ends with a period', () => {
        for (const { id, note } of CHANGES) assert.match(note, /^[ -~]+\.$/, id);
    });

    test('every tagged case names an id of the ledger', () => {
        for (const entry of CASES.filter(({ change }) => change !== undefined)) {
            assert.ok(
                ids.includes(entry.change as string),
                `${caseName(entry)} has the unknown change ${entry.change}`,
            );
        }
    });

    test('every id has a tagged case, or a synthetic test that carries its marker', () => {
        for (const { id, synthetic } of CHANGES) {
            if (!synthetic) {
                assert.ok(
                    CASES.some(({ change }) => change === id),
                    `${id} has no case`,
                );
                continue;
            }

            const text = fs.readFileSync(join(rootDir, synthetic), 'utf-8');
            const title = new RegExp(`^\\s*test\\('[^'\\n]*\\[change: ${id}\\]`, 'm');
            assert.match(text, title, `${synthetic} has no test titled with [change: ${id}]`);
        }
    });

    test('the cases have unique snapshot keys', () => {
        const names = CASES.map(caseName);

        assert.deepEqual(
            names.filter((name, i) => names.indexOf(name) !== i),
            [],
        );
    });

    test('no case is tagged with a decision that keeps the old behaviour', () => {
        const kept: (string | undefined)[] = CHANGES.filter(({ decision }) => decision === 'keep').map(({ id }) => id);

        assert.deepEqual(CASES.filter(({ change }) => kept.includes(change)).map(caseName), []);
    });
});
