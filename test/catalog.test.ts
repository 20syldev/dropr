import assert from 'assert/strict';
import { describe, test } from 'node:test';

import { countPackages, getProject, loadIndex, resolveVersion, searchPackages } from '../dist/lib/packages.js';
import type {
    CatalogDir,
    CatalogProject,
    Index,
    IndexFile,
    IndexNode,
    IndexProject,
    IndexVersion,
} from '../dist/types/index.js';

const SHA = 'a'.repeat(64);

/**
 * A node of the index as the fault cases edit it: every field optional and loosely typed.
 */
interface SpoilableEntry {
    kind?: string;
    name?: string;
    size?: number;
    exec?: boolean;
    sha256?: string | null;
    target?: string;
    real?: string;
}

/**
 * A version of the index as the fault cases edit it, with two entries at least.
 */
interface Spoilable {
    date: string;
    root: { name: string; entries: [SpoilableEntry, SpoilableEntry, ...SpoilableEntry[]] };
}

/**
 * Builds a file node.
 *
 * @param name - File name
 * @param size - Size in bytes, 1 by default
 * @returns The file node
 */
function file(name: string, size = 1): IndexFile {
    return { kind: 'file', name, size, exec: false, sha256: SHA };
}

/**
 * Builds a version whose root holds the given entries, released on 2025-05-01.
 *
 * @param name - Version name
 * @param entries - Nodes of the version folder in byte order, one file by default
 * @returns The version node
 */
function version(name: string, entries: IndexNode[] = [file('a.txt')]): IndexVersion {
    return { name, date: '2025-05-01', root: { kind: 'dir', name, entries } };
}

/**
 * Builds an index of one type, npm, with the given projects.
 *
 * @param projects - Projects as the index holds them, one project p with the version 1.0.0 by default
 * @returns The index
 */
function indexOf(projects: IndexProject[] = [{ name: 'p', versions: [version('1.0.0')] }]): Index {
    return { format: 2, types: [{ name: 'npm', projects }] };
}

/**
 * Builds an index with one project, p, that the given change spoils.
 *
 * @param change - Called with the version 1.0.0 of p, to edit in place
 * @returns The index
 */
function spoiled(change: (v: Spoilable) => unknown): Index {
    const v = version('1.0.0', [file('a.txt'), file('b.txt')]);
    change(v as unknown as Spoilable);

    return indexOf([{ name: 'p', versions: [v] }]);
}

describe('loadIndex', () => {
    test('builds the types, the projects and the versions in index order, with the latest of each project', () => {
        const projects: IndexProject[] = [
            { name: 'a', versions: [version('1.0.0'), version('1.2.0'), version('2.0.0-pre')] },
            { name: 'b', versions: [version('0.1.0-beta.2'), version('0.1.0-beta.10')] },
        ];
        const catalog = loadIndex({
            format: 2,
            types: [
                { name: 'bash', projects },
                { name: 'npm', projects },
            ],
        });
        const a = getProject(catalog, 'npm', 'a') as CatalogProject;

        assert.deepEqual([...catalog.types.keys()], ['bash', 'npm']);
        assert.deepEqual([...a.versions.keys()], ['1.0.0', '1.2.0', '2.0.0-pre']);
        assert.equal(a.latest.name, '1.2.0', 'the newest release wins over a newer pre-release');
        assert.equal(
            (getProject(catalog, 'npm', 'b') as CatalogProject).latest.name,
            '0.1.0-beta.10',
            'a project of pre-releases',
        );
        assert.equal(getProject(catalog, 'npm', 'nope'), undefined);
        assert.equal(getProject(catalog, 'nope', 'a'), undefined);
        assert.equal(countPackages(catalog), 4);
    });

    test('derives the size of each folder, a link to a file counting as its target and a link to a folder as nothing', () => {
        const root: IndexNode[] = [
            { kind: 'link', name: 'alias', target: 'dist/a.js', real: 'dist/a.js' },
            { kind: 'link', name: 'dangling', target: 'missing' },
            {
                kind: 'dir',
                name: 'dist',
                entries: [file('a.js', 5), file('b.js', 7), { kind: 'link', name: 'up', target: '..', real: '' }],
            },
            { kind: 'link', name: 'folder', target: 'dist', real: 'dist' },
            file('index.js', 3),
        ];
        const catalog = loadIndex(indexOf([{ name: 'p', versions: [version('1.0.0', root)] }]));
        const { nodes } = (getProject(catalog, 'npm', 'p') as CatalogProject).latest;

        assert.equal((nodes.get('dist') as CatalogDir).size, 12);
        assert.equal((nodes.get('') as CatalogDir).size, 5 + 12 + 3);
        assert.equal(nodes.get('')?.kind, 'dir');
        assert.equal(nodes.get('dist/up')?.kind, 'link');
    });

    test('derives the release day in milliseconds and keeps the date as the index writes it', () => {
        const v = (getProject(loadIndex(indexOf()), 'npm', 'p') as CatalogProject).latest;

        assert.equal(v.date, '2025-05-01');
        assert.equal(v.released, Date.UTC(2025, 4, 1));
        assert.deepEqual([v.type, v.project, v.name], ['npm', 'p', '1.0.0']);
    });

    test('keeps a deprecation notice that parseDeprecation accepts', () => {
        const deprecated = { date: '2026-10-17', message: 'Renamed.', successor: '/npm/q' };
        const catalog = loadIndex(indexOf([{ name: 'p', deprecated, versions: [version('1.0.0')] }]));

        assert.deepEqual(getProject(catalog, 'npm', 'p')?.deprecated, deprecated);
    });

    test('loads an index that went through JSON, an empty index included', () => {
        const index = indexOf([{ name: 'p', versions: [version('1.0.0'), version('1.1.0')] }]);

        assert.deepEqual(loadIndex(JSON.parse(JSON.stringify(index))), loadIndex(index));
        assert.equal(loadIndex({ format: 2, types: [] }).types.size, 0);
    });

    test('refuses another format, and what is no index', () => {
        for (const bad of [{ format: 1, types: [] }, { format: '2', types: [] }, {}, null] as unknown[]) {
            assert.throws(() => loadIndex(bad as Index), /Unsupported packages index format/, JSON.stringify(bad));
        }
    });

    test('refuses what the core relies on, naming the place of the fault', () => {
        const faults: [Index, RegExp][] = [
            [indexOf([{ name: 'list', versions: [version('1.0.0')] }]), /npm holds the name "list"/],
            [indexOf([{ name: 'a@b', versions: [version('1.0.0')] }]), /npm holds the name "a@b"/],
            [indexOf([{ name: '.hidden', versions: [version('1.0.0')] }]), /npm holds the name "\.hidden"/],
            [indexOf([{ name: 'a b', versions: [version('1.0.0')] }]), /npm holds the name "a b"/],
            [indexOf([{ name: 'caf\u00e9', versions: [version('1.0.0')] }]), /npm holds the name "caf\u00e9"/],
            [indexOf([{ name: 'p', versions: [] }]), /npm\/p has no version/],
            [indexOf([{ name: 'p', versions: [version('v1.0.0')] }]), /npm\/p holds the version "v1.0.0"/],
            [
                indexOf([{ name: 'p', versions: [version('1.2.0'), version('1.10.0'), version('1.9.0')] }]),
                /lists 1\.9\.0 after 1\.10\.0/,
            ],
            [indexOf([{ name: 'p', versions: [version('1.0.0'), version('1.0.0')] }]), /lists 1\.0\.0 after 1\.0\.0/],
            [
                indexOf([
                    { name: 'b', versions: [version('1.0.0')] },
                    { name: 'a', versions: [version('1.0.0')] },
                ]),
                /lists a after b/,
            ],
            [
                {
                    format: 2,
                    types: [
                        { name: 'b', projects: [] },
                        { name: 'a', projects: [] },
                    ],
                },
                /lists the type a after b/,
            ],
            [{ format: 2, types: [{ name: 'a/b', projects: [] }] }, /holds the name "a\/b"/],
            [{ format: 2, types: [{ name: '', projects: [] }] }, /holds the name ""/],
            [spoiled((v) => (v.date = '2025-02-30')), /npm\/p\/1\.0\.0 has a release date that is no YYYY-MM-DD day/],
            [spoiled((v) => (v.date = '1969-12-31')), /npm\/p\/1\.0\.0 has a release date/],
            [spoiled((v) => (v.root.name = '2.0.0')), /has no root folder named like the version/],
            [spoiled((v) => v.root.entries.reverse()), /npm\/p\/1\.0\.0\/ lists a\.txt after b\.txt/],
            [spoiled((v) => v.root.entries.push(file('b.txt'))), /lists b\.txt after b\.txt/],
            [spoiled((v) => v.root.entries.push(file('c/d'))), /holds the name "c\/d", which no route can match/],
            [spoiled((v) => v.root.entries.push(file('e\\f'))), /holds the name "e\\\\f"/],
            [spoiled((v) => v.root.entries.push(file('..'))), /holds the name ".."/],
            [spoiled((v) => (v.root.entries[0].sha256 = null)), /npm\/p\/1\.0\.0\/a\.txt has no SHA-256 in hex/],
            [spoiled((v) => (v.root.entries[0].sha256 = 'A'.repeat(64))), /has no SHA-256 in hex/],
            [spoiled((v) => (v.root.entries[0].size = -1)), /has a size that is not a byte count/],
            [spoiled((v) => (v.root.entries[0].size = 1.5)), /has a size that is not a byte count/],
            [spoiled((v) => delete v.root.entries[0].exec), /has no execute flag/],
            [spoiled((v) => (v.root.entries[0].kind = 'fifo')), /is neither a folder, a file nor a link/],
            [spoiled((v) => (v.root.entries[1] = { kind: 'dir', name: 'b.txt' })), /has no entries/],
            [
                spoiled((v) => v.root.entries.push({ kind: 'link', name: 'l', target: 't', real: 'missing' })),
                /leads to a path that is no node/,
            ],
            [spoiled((v) => v.root.entries.push({ kind: 'link', name: 'l', real: 'a.txt' })), /has no target/],
            [
                spoiled((v) =>
                    v.root.entries.push(
                        { kind: 'link', name: 'm', target: 'l', real: 'n' },
                        { kind: 'link', name: 'n', target: 'm', real: 'm' },
                    ),
                ),
                /leads to a path that is no node/,
            ],
            [
                indexOf([
                    {
                        name: 'p',
                        deprecated: { date: 'June 1, 2025', message: 'm', successor: '/npm/q' },
                        versions: [version('1.0.0')],
                    },
                ]),
                /npm\/p has a deprecation notice that is refused/,
            ],
        ];

        for (const [index, message] of faults) assert.throws(() => loadIndex(index), message, String(message));
    });
});

describe('resolveVersion', () => {
    const project = getProject(
        loadIndex(
            indexOf([
                {
                    name: 'p',
                    versions: ['1.0.0', '1.2.0', '1.10.0', '2.0.0-pre.1', '2.0.0-pre.2', '3.0.0-rc.1'].map((v) =>
                        version(v),
                    ),
                },
            ]),
        ),
        'npm',
        'p',
    ) as CatalogProject;
    const pick = (pattern: string) => resolveVersion(pattern, project)?.name;

    test('resolves a leading part to the newest version that starts with it, a release before a pre-release', () => {
        assert.equal(pick('1'), '1.10.0');
        assert.equal(pick('1.2'), '1.2.0');
        assert.equal(pick('1.1'), undefined, '1.1 is not a prefix of 1.10.0 at a dot');
        assert.equal(pick('2'), '2.0.0-pre.2', 'only pre-releases match');
        assert.equal(pick('3'), '3.0.0-rc.1');
        assert.equal(pick('9'), undefined);
    });

    test('takes a major or a major and a minor and no other spelling', () => {
        for (const asked of [
            '1.',
            '1.2.',
            '1.2.0',
            '2.0.0-pre',
            '2.0.0-pre.',
            '01',
            '1.02',
            '1.x',
            'x',
            '',
            'latest',
        ]) {
            assert.equal(pick(asked), undefined, JSON.stringify(asked));
        }
    });
});

describe('searchPackages', () => {
    test('lists name matches first, then the projects of the type that the query names, latest alias first', () => {
        const catalog = loadIndex({
            format: 2,
            types: [
                { name: 'bash', projects: [{ name: 'gft', versions: [version('1.0.0'), version('1.1.0')] }] },
                { name: 'npm', projects: [{ name: 'bash-utils', versions: [version('1.0.0')] }] },
            ],
        });

        assert.deepEqual(
            searchPackages(catalog, 'BASH').map(({ type, name, versions }) => [type, name, versions]),
            [
                ['npm', 'bash-utils', ['latest', '1.0.0']],
                ['bash', 'gft', ['latest', '1.0.0', '1.1.0']],
            ],
        );
        assert.equal(searchPackages(catalog, '').length, 2);
    });
});
