import assert from 'assert/strict';
import { describe, test } from 'node:test';

import { compareVersions, isRelease, isVersion } from '../dist/lib/semver.js';

import { ACCEPTED, REFUSED } from './names.ts';

describe('isVersion', () => {
    test('accepts X.Y.Z and X.Y.Z-tag as semver.org writes them', () => {
        for (const name of ACCEPTED) assert.equal(isVersion(name), true, name);
    });

    test('refuses every other name, whatever a folder may be called', () => {
        for (const name of REFUSED) assert.equal(isVersion(name), false, JSON.stringify(name));
    });

    test('tells a release from a pre-release', () => {
        assert.equal(isRelease('1.0.0'), true);
        assert.equal(isRelease('1.0.0-rc.1'), false);
        assert.equal(isRelease('0.1.0-beta.10'), false);
    });
});

describe('compareVersions', () => {
    test('follows the chain of semver.org section 11', () => {
        const chain = [
            '1.0.0-alpha',
            '1.0.0-alpha.1',
            '1.0.0-alpha.beta',
            '1.0.0-beta',
            '1.0.0-beta.2',
            '1.0.0-beta.11',
            '1.0.0-rc.1',
            '1.0.0',
            '1.0.1',
            '1.2.0',
            '1.10.0',
            '2.0.0-pre',
            '2.0.0',
            '10.0.0',
        ];

        for (const [i, a] of chain.entries()) {
            for (const [j, b] of chain.entries())
                assert.equal(Math.sign(compareVersions(a, b)), Math.sign(i - j), `${a} ${b}`);
        }
    });

    test('compares numbers as numbers and tags by ASCII, without a locale and without a limit on the digits', () => {
        assert.ok(compareVersions('1.0.0-rc.2', '1.0.0-rc.10') < 0, 'numeric identifiers compare as numbers');
        assert.ok(compareVersions('1.0.0-rc2', '1.0.0-rc10') > 0, 'alphanumeric identifiers compare by ASCII');
        assert.ok(compareVersions('1.0.0-RC.1', '1.0.0-alpha') < 0, 'upper case sorts before lower case');
        assert.ok(
            compareVersions('1.0.0-a-b', '1.0.0-a.b') > 0,
            'a-b is one identifier, which ranks after the identifier a',
        );
        assert.ok(compareVersions('9007199254740993.0.0', '9007199254740992.0.0') > 0, 'no float rounding');
    });

    test('sorts a list in place, which is how scan orders a project', () => {
        const names = ['1.10.0', '1.2.0', '2.0.0-pre', '1.9.0', '2.0.0'];

        assert.deepEqual(names.sort(compareVersions), ['1.2.0', '1.9.0', '1.10.0', '2.0.0-pre', '2.0.0']);
    });

    test('throws on a name that is no version, since nothing orders it', () => {
        assert.throws(() => compareVersions('v1.0.0', '1.0.0'), /v1\.0\.0 is not a version name/);
        assert.throws(() => compareVersions('1.0.0', 'latest'), /latest is not a version name/);
    });
});
