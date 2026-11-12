import assert from 'assert/strict';
import { describe, test } from 'node:test';

import { loadIndex } from '../dist/lib/packages.js';
import { listing } from '../dist/lib/route.js';
import { errorPage, homePage, projectPage, searchPage, typePage, versionPage } from '../dist/lib/pages.js';
import type { SiteInfo } from '../dist/lib/pages.js';
import type {
    Catalog,
    CatalogDir,
    CatalogProject,
    CatalogVersion,
    IndexNode,
    IndexVersion,
} from '../dist/types/index.js';

const SITE: SiteInfo = { name: 'Acme <CDN>', version: '4.3.0', baseUrl: 'https://cdn.example.com' };
const SHA = 'a'.repeat(64);

/**
 * Gives the latest version that the tests of the search page expect.
 *
 * @returns The same version for every result
 */
function latest(): string {
    return '1.1.0';
}

const HOSTILE = '<img src=x onerror=alert(1)>.js';

/**
 * Makes a file node of an index.
 *
 * @param name - Name of the file
 * @param size - Size in bytes
 * @returns The node
 */
function file(name: string, size: number): IndexNode {
    return { kind: 'file', name, size, exec: false, sha256: SHA };
}

/**
 * Makes a version of an index.
 *
 * @param name - Version name
 * @param date - Release day
 * @param entries - Files and folders at its root
 * @returns The version
 */
function version(name: string, date: string, entries: IndexNode[]): IndexVersion {
    return { name, date, root: { kind: 'dir', name, entries } };
}

/**
 * Makes the catalog the tests share: a deprecated project with three versions, a plain one, a second type.
 *
 * @returns The catalog
 */
function makeCatalog(): Catalog {
    const dist = { kind: 'dir' as const, name: 'dist', entries: [file('a.js', 2048), file('b c#d.js', 5)] };
    const files = [file(HOSTILE, 1), dist, file('index.js', 1536)];

    return loadIndex({
        format: 2,
        types: [
            {
                name: 'bash',
                projects: [{ name: 'tool', versions: [version('1.0.0', '2025-02-01', [file('tool', 12)])] }],
            },
            {
                name: 'npm',
                projects: [
                    {
                        name: 'lib',
                        deprecated: { date: '2025-06-01', message: 'Old <b>& unmaintained.', successor: '/npm/next' },
                        versions: [
                            version('1.0.0', '2025-01-01', files),
                            version('1.1.0', '2025-03-01', files),
                            version('2.0.0-pre', '2025-05-01', files),
                        ],
                    },
                    { name: 'next', versions: [version('1.0.0', '2025-06-02', [file('index.js', 1)])] },
                ],
            },
        ],
    });
}

/**
 * Looks for what a page must never hold: a script, an inline event handler, an embedding element or a script address.
 *
 * @param html - The document
 * @returns The first thing found, or null
 */
function danger(html: string): string | null {
    const found = /<script|<iframe|<object|<embed|<[a-z][^>]*\son[a-z]+\s*=|javascript:/i.exec(html);

    return found && found[0];
}

/**
 * Gets a project of the shared catalog.
 *
 * @param catalog - Catalog of makeCatalog
 * @param type - Type name
 * @param name - Project name
 * @returns The project
 */
function projectOf(catalog: Catalog, type: string, name: string): CatalogProject {
    return catalog.types.get(type)!.projects.get(name)!;
}

describe('the pages', () => {
    const catalog = makeCatalog();
    const types = [...catalog.types.values()];
    const lib = projectOf(catalog, 'npm', 'lib');

    test('make a whole document that escapes the name of the server and holds no script', () => {
        const pages = [
            homePage(SITE, types),
            searchPage(SITE, 'q', [], latest),
            typePage(SITE, types[1]),
            projectPage(SITE, 'npm', lib, null),
            versionPage(SITE, lib, lib.latest, '', [], null),
            errorPage(SITE, 404, 'Nothing <here>.'),
        ];

        for (const html of pages) {
            assert.match(html, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">/);
            assert.match(html, /<title>[^<]*Acme &#60;CDN&#62;<\/title>/);
            assert.match(html, /<a class="brand" href="\/">Acme &#60;CDN&#62;<\/a>/);
            assert.match(html, /<form action="\/search" method="get" role="search">/);
            assert.match(html, /<footer>Powered by dropr 4\.3\.0<\/footer>\n<\/body>\n<\/html>\n$/);
            assert.ok(!html.includes('<CDN>'));
            assert.equal(danger(html), null);
        }
    });

    test('list the types and their projects on the front page, with the latest version and the deprecation', () => {
        const html = homePage(SITE, types);

        assert.match(html, /<p class="lead">3 packages in 2 types\.<\/p>/);
        assert.match(html, /<h2><a href="\/npm">npm<\/a><\/h2>/);
        assert.match(
            html,
            /<a href="\/npm\/lib">lib<\/a> <span class="mark dep">Deprecated<\/span><span class="dots"><\/span><span class="end">1\.1\.0<\/span>/,
        );
        assert.match(
            html,
            /<a href="\/npm\/next">next<\/a><span class="dots"><\/span><span class="end">1\.0\.0<\/span>/,
        );
        assert.match(
            html,
            /<a href="\/manifest">Routes<\/a> - <a href="\/health">Health<\/a> - <a href="\/download">Archives<\/a>/,
        );
        assert.match(homePage(SITE, []), /<p class="lead">No packages yet\.<\/p>/);
    });

    test('send the reader to the page of a type that has too many projects for the front page', () => {
        const projects = Array.from({ length: 31 }, (_, n) => ({
            name: `p${String(n).padStart(2, '0')}`,
            versions: [version('1.0.0', '2025-01-01', [file('a', 1)])],
        }));
        const many = loadIndex({ format: 2, types: [{ name: 'npm', projects }] });
        const html = homePage(SITE, [...many.types.values()]);

        assert.ok(html.includes('<a href="/npm/p29">'));
        assert.ok(!html.includes('<a href="/npm/p30">'));
        assert.match(html, /<a href="\/npm">All 31 projects<\/a>/);
    });

    test('show the results of a search, and give the text back escaped in the box', () => {
        const html = searchPage(
            SITE,
            'li"><b>',
            [{ type: 'npm', name: 'lib', versions: ['1.0.0', '1.1.0'], url: '/npm/lib', deprecated: lib.deprecated }],
            latest,
        );

        assert.match(html, /<input type="search" name="q" value="li&#34;&#62;&#60;b&#62;"/);
        assert.match(html, /<p class="lead">1 result for li&#34;&#62;&#60;b&#62;\.<\/p>/);
        assert.match(
            html,
            /<a href="\/npm\/lib">npm\/lib<\/a> <span class="mark dep">Deprecated<\/span><span class="dots"><\/span><span class="end">1\.1\.0<\/span>/,
        );
        assert.match(searchPage(SITE, 'zzz', [], latest), /<p class="lead">0 results for zzz\.<\/p>/);
        assert.match(searchPage(SITE, '', [], latest), /<p class="lead">Type a name to search the packages\.<\/p>/);
        assert.match(searchPage(SITE, '', [], latest), /<title>Search - /);
    });

    test('list the projects of a type with a link to its archives', () => {
        const html = typePage(SITE, types[1]);

        assert.match(html, /<nav class="crumbs"><a href="\/">All packages<\/a> \/ npm<\/nav>/);
        assert.match(html, /<h1>npm<\/h1>\n<p class="lead">2 projects\.<\/p>/);
        assert.match(html, /<a href="\/download\/npm">Archives<\/a>/);
        assert.match(html, /<a href="\/npm\/next">next<\/a>/);
    });

    test('show how to use a project, its versions newest first, and the README', () => {
        const html = projectPage(SITE, 'npm', lib, '<p>Hello <em>readme</em></p>\n');

        assert.match(html, /<h1>lib <span class="mark dep">Deprecated<\/span><\/h1>/);
        assert.match(html, /<p class="lead">Latest version 1\.1\.0, released 2025-03-01\.<\/p>/);
        assert.match(
            html,
            /<dt>Latest<\/dt><dd><a href="\/npm\/lib@latest"><code>https:\/\/cdn\.example\.com\/npm\/lib@latest\/<\/code>/,
        );
        assert.match(
            html,
            /<dt>Pinned<\/dt><dd><a href="\/npm\/lib@1\.1\.0"><code>https:\/\/cdn\.example\.com\/npm\/lib@1\.1\.0\/<\/code>/,
        );
        assert.match(
            html,
            /<a href="\/download\/npm\/lib@1\.1\.0"><code>https:\/\/cdn\.example\.com\/download\/npm\/lib@1\.1\.0<\/code>/,
        );

        const order = ['2.0.0-pre', '1.1.0', '1.0.0'].map((name) => html.indexOf(`<td><a href="/npm/lib@${name}">`));
        assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], order.join());
        assert.match(
            html,
            /<a href="\/npm\/lib@2\.0\.0-pre">2\.0\.0-pre<\/a> <span class="mark pre">Pre-release<\/span><\/td><td>2025-05-01/,
        );
        assert.match(html, /<a href="\/npm\/lib@1\.1\.0">1\.1\.0<\/a> <span class="mark latest">Latest<\/span><\/td>/);
        assert.match(html, /<section class="markdown">\n<h2>README<\/h2>\n<p>Hello <em>readme<\/em><\/p>\n<\/section>/);
        assert.ok(!projectPage(SITE, 'npm', lib, null).includes('README'));
    });

    test('show a deprecation with its message escaped, and its successor as a link only when it can be followed', () => {
        const html = projectPage(SITE, 'npm', lib, null);

        assert.match(
            html,
            /<p class="notice"><strong>Deprecated<\/strong> since 2025-06-01: Old &#60;b&#62;&#38; unmaintained\. Use <a href="\/npm\/next">\/npm\/next<\/a> instead\.<\/p>/,
        );

        const odd = loadIndex({
            format: 2,
            types: [
                {
                    name: 'npm',
                    projects: [
                        {
                            name: 'old',
                            deprecated: { date: '2025-06-01', message: 'Gone.', successor: 'javascript:alert(1)' },
                            versions: [version('1.0.0', '2025-01-01', [file('a', 1)])],
                        },
                    ],
                },
            ],
        });
        const page = projectPage(SITE, 'npm', projectOf(odd, 'npm', 'old'), null);

        assert.match(page, /Use javascript:alert\(1\) instead\./);
        assert.ok(!page.includes('href="javascript'));
    });

    test('list the files of a version, folders first, with sizes, escaped names and encoded addresses', () => {
        const entries = listing(lib.latest, lib.latest.root.entries);
        const html = versionPage(SITE, lib, lib.latest, '', entries, null);

        assert.match(
            html,
            /<nav class="crumbs"><a href="\/">All packages<\/a> \/ <a href="\/npm">npm<\/a> \/ <a href="\/npm\/lib">lib<\/a> \/ 1\.1\.0<\/nav>/,
        );
        assert.match(html, /<h1>lib@1\.1\.0<\/h1>\n<p class="lead">Released 2025-03-01\.<\/p>/);
        assert.match(
            html,
            /<a href="\/download\/npm\/lib@1\.1\.0">Download \.tar\.gz<\/a> - <a href="\/npm\/lib@1\.1\.0\?checksums">Checksums<\/a>/,
        );
        assert.match(html, /<a href="\/npm\/lib@1\.1\.0\/dist\/">dist\/<\/a><\/td><td class="right">2\.0 KB<\/td>/);
        assert.match(
            html,
            /<a href="\/npm\/lib@1\.1\.0\/index\.js">index\.js<\/a><\/td><td class="right">1\.5 KB<\/td>/,
        );
        assert.ok(html.indexOf('dist/</a>') < html.indexOf('>index.js</a>'));
        assert.ok(html.includes('href="/npm/lib@1.1.0/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E.js"'));
        assert.ok(html.includes('&#60;img src=x onerror=alert(1)&#62;.js</a>'));
        assert.equal(danger(html), null);
    });

    test('show a folder of a version with the way back, and no actions of the root', () => {
        const dist = lib.latest.root.entries.find((node) => node.name === 'dist');
        assert.equal(dist?.kind, 'dir');
        const entries = listing(lib.latest, (dist as CatalogDir).entries);
        const html = versionPage(SITE, lib, lib.latest, 'dist', entries, null);

        assert.match(html, /<nav class="crumbs">.*<a href="\/npm\/lib@1\.1\.0\/">1\.1\.0<\/a> \/ dist<\/nav>/);
        assert.match(html, /<h1>lib@1\.1\.0\/dist<\/h1>/);
        assert.ok(!html.includes('Download .tar.gz'));
        assert.ok(html.includes('href="/npm/lib@1.1.0/dist/b%20c%23d.js"'));
        assert.match(html, /<td class="right">5 B<\/td>/);

        const deep = versionPage(SITE, lib, lib.latest, 'dist/sub', [], null);
        assert.match(
            deep,
            /<a href="\/npm\/lib@1\.1\.0\/">1\.1\.0<\/a> \/ <a href="\/npm\/lib@1\.1\.0\/dist\/">dist<\/a> \/ sub<\/nav>/,
        );
        assert.match(deep, /<p class="meta">This folder is empty\.<\/p>/);
    });

    test('mark a pre-release version, and show the README of a version at its root only', () => {
        const pre = lib.versions.get('2.0.0-pre') as CatalogVersion;

        assert.match(
            versionPage(SITE, lib, pre, '', [], '<p>r</p>\n'),
            /<h1>lib@2\.0\.0-pre <span class="mark pre">Pre-release<\/span><\/h1>[\s\S]*<h2>README<\/h2>\n<p>r<\/p>/,
        );
    });

    test('list a file whose name holds a lone surrogate without failing, and encode it as a replacement', () => {
        const odd = loadIndex({
            format: 2,
            types: [
                {
                    name: 'npm',
                    projects: [{ name: 'lib', versions: [version('1.0.0', '2025-01-01', [file('a\ud800.js', 1)])] }],
                },
            ],
        });
        const project = projectOf(odd, 'npm', 'lib');
        const html = versionPage(
            SITE,
            project,
            project.latest,
            '',
            listing(project.latest, project.latest.root.entries),
            null,
        );

        assert.ok(html.includes('href="/npm/lib@1.0.0/a%EF%BF%BD.js"'));
        assert.doesNotThrow(() => versionPage(SITE, project, project.latest, 'x\udc00', [], null));
    });

    test('follow a successor only when it is a path of this server or an http(s) address', () => {
        const successors: [string, boolean][] = [
            ['/npm/next', true],
            ['https://cdn.example.com/npm/next', true],
            ['//evil.example', false],
            ['/\\evil.example', false],
            ['mailto:a@b.c', false],
            ['next', false],
        ];

        for (const [successor, followed] of successors) {
            const odd = loadIndex({
                format: 2,
                types: [
                    {
                        name: 'npm',
                        projects: [
                            {
                                name: 'old',
                                deprecated: { date: '2025-06-01', message: 'Gone.', successor },
                                versions: [version('1.0.0', '2025-01-01', [file('a', 1)])],
                            },
                        ],
                    },
                ],
            });
            const page = projectPage(SITE, 'npm', projectOf(odd, 'npm', 'old'), null);

            assert.equal(page.includes('<a href="' + successor.replace(/&/g, '&#38;')), followed, successor);
        }
    });

    test('end the message of a deprecation with a full stop, and have a sentence without a message', () => {
        const notices: [string, string][] = [
            ['Moved', 'since 2025-06-01: Moved. Use'],
            ['Moved!', 'since 2025-06-01: Moved! Use'],
            ['  Moved  ', 'since 2025-06-01: Moved. Use'],
            ['', 'since 2025-06-01. Use'],
        ];

        for (const [message, expected] of notices) {
            const odd = loadIndex({
                format: 2,
                types: [
                    {
                        name: 'npm',
                        projects: [
                            {
                                name: 'old',
                                deprecated: { date: '2025-06-01', message, successor: '/npm/next' },
                                versions: [version('1.0.0', '2025-01-01', [file('a', 1)])],
                            },
                        ],
                    },
                ],
            });

            assert.ok(projectPage(SITE, 'npm', projectOf(odd, 'npm', 'old'), null).includes(expected), message);
        }
    });

    test('write the marks after a space, and the latest version in a style of its own', () => {
        const project = projectPage(SITE, 'npm', lib, null);

        assert.match(project, /<h1>lib <span class="mark dep">Deprecated<\/span><\/h1>/);
        assert.match(project, /<a href="\/npm\/lib@1\.1\.0">1\.1\.0<\/a> <span class="mark latest">Latest<\/span>/);
        assert.doesNotMatch(project, /<span class="mark pre">Latest/);
        assert.match(homePage(SITE, types), /<a href="\/npm\/lib">lib<\/a> <span class="mark dep">Deprecated<\/span>/);
    });

    test('give a folder its own title, and show the version found by a search rather than the highest', () => {
        const dist = lib.latest.root.entries.find((node) => node.name === 'dist') as CatalogDir;

        assert.match(
            versionPage(SITE, lib, lib.latest, 'dist', listing(lib.latest, dist.entries), null),
            /<title>lib@1\.1\.0\/dist - /,
        );
        assert.match(versionPage(SITE, lib, lib.latest, '', [], null), /<title>lib@1\.1\.0 - /);

        const html = searchPage(
            SITE,
            'lib',
            [{ type: 'npm', name: 'lib', versions: ['latest', '1.0.0', '1.1.0', '2.0.0-pre'], url: '/npm/lib' }],
            () => '1.1.0',
        );

        assert.match(html, /<span class="end">1\.1\.0<\/span>/);
        assert.doesNotMatch(html, /2\.0\.0-pre/);
    });

    test('count in the singular, list exactly the limit of a type without a link to the rest, and write sizes', () => {
        const projects = (count: number) =>
            Array.from({ length: count }, (_, n) => ({
                name: `p${String(n).padStart(2, '0')}`,
                versions: [version('1.0.0', '2025-01-01', [file('a', 1)])],
            }));
        const just = (count: number) => loadIndex({ format: 2, types: [{ name: 'npm', projects: projects(count) }] });

        const thirty = homePage(SITE, [...just(30).types.values()]);
        assert.ok(thirty.includes('<a href="/npm/p29">'));
        assert.ok(!thirty.includes('All 30 projects'));
        assert.match(homePage(SITE, [...just(1).types.values()]), /<p class="lead">1 package in 1 type\.<\/p>/);
        assert.match(homePage(SITE, []), /<p class="lead">No packages yet\.<\/p>/);
        assert.match(typePage(SITE, [...just(1).types.values()][0]), /<p class="lead">1 project\.<\/p>/);

        const sizes: [number, string][] = [
            [0, '0 B'],
            [1023, '1023 B'],
            [1024, '1.0 KB'],
            [1048575, '1024.0 KB'],
            [1048576, '1.0 MB'],
            [1073741824, '1.0 GB'],
            [5497558138880, '5120.0 GB'],
        ];
        for (const [size, text] of sizes) {
            const table = versionPage(SITE, lib, lib.latest, '', [{ name: 'f', size, directory: false }], null);

            assert.ok(table.includes(`<td class="right">${text}</td>`), `${size} -> ${text}`);
        }
    });

    test('escape and encode every text that a page repeats: the trail, the folder, the successor and the site', () => {
        const odd = loadIndex({
            format: 2,
            types: [
                {
                    name: 'npm',
                    projects: [
                        {
                            name: 'lib',
                            deprecated: { date: '2025-06-01', message: 'x', successor: '/npm/s&t' },
                            versions: [version('1.0.0', '2025-01-01', [file('a', 1)])],
                        },
                    ],
                },
            ],
        });
        const project = projectOf(odd, 'npm', 'lib');
        const site: SiteInfo = { name: '"><svg onload=x>', version: "1'<i>", baseUrl: 'https://x.y/"><b>' };
        const pages = [
            homePage(site, [...odd.types.values()]),
            typePage(site, odd.types.get('npm')!),
            projectPage(site, 'npm', project, null),
            versionPage(site, project, project.latest, '', listing(project.latest, project.latest.root.entries), null),
            versionPage(site, project, project.latest, 'a<b>/c d', [], null),
            searchPage(site, '<q>"', [{ type: 'npm', name: 'lib', versions: [], url: '/' }], () => "<'>"),
            errorPage(site, 500, '<m>'),
        ];

        for (const html of pages) {
            assert.equal(danger(html), null);
            assert.doesNotMatch(html.replace(/<style>[\s\S]*<\/style>/, ''), /<svg|<b>|<i>|<q>|<m>/);
        }
        assert.ok(pages[4].includes('href="/npm/lib@1.0.0/"'));
        assert.ok(pages[4].includes('href="/npm/lib@1.0.0/a%3Cb%3E/"'));
        assert.ok(pages[4].includes('<h1>lib@1.0.0/a&#60;b&#62;/c d</h1>'));
        assert.ok(pages[2].includes('href="/npm/s&#38;t"'));
    });

    test('write an error with its status and its escaped message', () => {
        const html = errorPage(SITE, 404, "Route '/<x>' does not exist.");

        assert.match(html, /<h1>404<\/h1>\n<p class="lead">Route &#39;\/&#60;x&#62;&#39; does not exist\.<\/p>/);
        assert.match(html, /<title>404 - /);
        assert.match(html, /<a href="\/">Back to all packages<\/a>/);
    });
});
