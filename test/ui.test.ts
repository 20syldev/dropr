import assert from 'assert/strict';
import fs from 'fs';
import { after, before, describe, test } from 'node:test';
import { join } from 'path';

import { STYLE } from '../dist/lib/style.js';
import { GUIDES } from '../dist/lib/guides.js';
import { styleOf } from '../dist/lib/theme.js';
import { prefersHtml } from '../dist/lib/ui.js';

import { createDocsTree } from './docs.ts';
import type { DocsTree } from './docs.ts';
import { createFixture } from './fixture.ts';
import type { Fixture } from './fixture.ts';
import { DOCS, PAGES, request, startServer } from './server.ts';
import type { TestServer } from './server.ts';

// What a browser sends to open a page
const BROWSER = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};

// Paths that name nothing, whose page is the one of an error
const MISSING = ['/nope', '/search/x', '/npm/lib/nope/x', '/nope/x/y', '/%E0'];

// Paths that have a JSON form and a page
const NEGOTIATED = ['/', '/search?q=lib', '/npm', '/npm/lib', '/npm/lib@1.2.0', '/npm/lib@1.2.0/dist/', ...MISSING];

// Paths that never have a page
const PLAIN = [
    '/health',
    '/manifest',
    '/download',
    '/download/npm',
    '/download/npm/lib@1.2.0',
    '/npm/lib/changelog',
    '/npm/lib@1.2.0/index.js',
];

// What a page may load and run: nothing but its own style, the images of a README and a form that goes to the search
const POLICY =
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/**
 * Reads the text of the body of a reply.
 *
 * @param reply - Reply of request()
 * @returns The body as UTF-8
 */
function textOf(reply: { body: Buffer }): string {
    return reply.body.toString('utf-8');
}

describe('prefersHtml', () => {
    test('is true for a browser and false for the clients that want data', () => {
        const cases: [string | null, boolean][] = [
            [BROWSER.accept, true],
            ['text/html', true],
            ['application/xhtml+xml', true],
            ['TEXT/HTML ; Q=0.5', true],
            [null, false],
            ['', false],
            ['*/*', false],
            ['application/json', false],
            ['application/json, text/plain, */*', false],
            ['text/html;q=0', false],
            ['text/html;q=0.5, application/json', false],
            ['application/json, text/html', false],
            ['text/html, application/json;q=0.9', true],
            ['text/htmlx', false],
            ['text/html;q=abc', false],
        ];

        for (const [accept, expected] of cases) assert.equal(prefersHtml(accept), expected, String(accept));
    });
});

describe('the pages', () => {
    let fixture: Fixture;
    let off: TestServer;
    let on: TestServer;

    before(async () => {
        fixture = createFixture();
        off = await startServer(fixture.packagesDir);
        on = await startServer(fixture.packagesDir, { ui: PAGES });
    });

    after(async () => {
        await off?.stop();
        await on?.stop();
        fixture?.remove();
    });

    test('are off unless the config turns them on: a browser gets the JSON and no Vary', async () => {
        for (const path of ['/', '/npm', '/npm/lib', '/npm/lib@1.2.0']) {
            const reply = await request(off.port, 'GET', path, BROWSER);

            assert.equal(reply.status, 200, path);
            assert.match(String(reply.headers['content-type']), /^application\/json/, path);
            assert.equal(reply.headers.vary, undefined, path);
        }
    });

    test('leave the JSON to every client that does not ask for HTML, and say that the answer depends on Accept', async () => {
        for (const path of NEGOTIATED.filter((path) => !MISSING.includes(path))) {
            const clients: Record<string, string>[] = [{}, { accept: '*/*' }, { accept: 'application/json' }];
            for (const headers of clients) {
                const reply = await request(on.port, 'GET', path, headers);

                assert.match(String(reply.headers['content-type']), /^application\/json/, path);
                assert.equal(reply.headers.vary, 'Accept', path);
                assert.ok(JSON.parse(textOf(reply)), path);
            }
        }
        for (const path of PLAIN) {
            const reply = await request(on.port, 'GET', path, BROWSER);

            assert.doesNotMatch(String(reply.headers['content-type']), /^text\/html/, path);
            assert.equal(reply.headers.vary, undefined, path);
        }
    });

    test('answer a browser with a page that is safe to open, whatever the path', async () => {
        for (const path of NEGOTIATED) {
            const reply = await request(on.port, 'GET', path, BROWSER);
            const html = textOf(reply);

            assert.equal(reply.status, MISSING.includes(path) ? (path === '/%E0' ? 400 : 404) : 200, path);
            assert.equal(reply.headers['content-type'], 'text/html; charset=utf-8');
            assert.equal(reply.headers.vary, 'Accept');
            assert.equal(reply.headers['x-content-type-options'], 'nosniff');
            assert.equal(reply.headers['referrer-policy'], 'same-origin');
            assert.equal(reply.headers['access-control-allow-origin'], '*');
            assert.equal(reply.headers['content-length'], String(reply.body.length));
            assert.equal(reply.headers['content-security-policy'], POLICY);
            assert.equal(reply.headers['cache-control'], MISSING.includes(path) ? undefined : 'public, max-age=300');
            assert.match(html, /^<!doctype html>/);
            assert.doesNotMatch(html, /<script|\son[a-z]+=/i);
        }
    });

    test('show the front page, a type, a project with its README, a version and a folder', async () => {
        const home = textOf(await request(on.port, 'GET', '/', BROWSER));
        assert.match(home, /<h2><a href="\/npm">npm<\/a><\/h2>/);
        assert.match(
            home,
            /<a href="\/bash\/gft">gft<\/a><span class="dots"><\/span><span class="end">1\.2\.0<\/span>/,
        );
        assert.match(home, /<a href="\/npm\/old">old<\/a> <span class="mark dep">Deprecated<\/span>/);

        const type = textOf(await request(on.port, 'GET', '/npm', BROWSER));
        assert.match(type, /<h1>npm<\/h1>/);
        assert.match(type, /<a href="\/npm\/lib">lib<\/a>/);

        const project = textOf(await request(on.port, 'GET', '/bash/gft', BROWSER));
        assert.match(project, /<h1>gft<\/h1>/);
        assert.match(project, /<a href="\/bash\/gft@1\.1\.0">1\.1\.0<\/a>/);
        assert.match(project, /<h2>README<\/h2>\n<h3 id="gft">gft<\/h3>/);

        const old = textOf(await request(on.port, 'GET', '/npm/old', BROWSER));
        assert.match(old, /<p class="notice"><strong>Deprecated<\/strong> since 2025-06-01: Renamed to lib\./);

        const version = textOf(await request(on.port, 'GET', '/npm/lib@1.2.0', BROWSER));
        assert.match(version, /<h1>lib@1\.2\.0<\/h1>/);
        assert.match(version, /<a href="\/npm\/lib@1\.2\.0\/dist\/">dist\/<\/a>/);
        assert.match(version, /<a href="\/download\/npm\/lib@1\.2\.0">Download \.tar\.gz<\/a>/);

        const folder = textOf(await request(on.port, 'GET', '/npm/lib@1.2.0/dist/', BROWSER));
        assert.match(folder, /<h1>lib@1\.2\.0\/dist<\/h1>/);
        assert.match(folder, /<a href="\/npm\/lib@1\.2\.0\/dist\/index\.mjs">index\.mjs<\/a>/);
    });

    test('resolve latest and partial versions to the version they stand for', async () => {
        assert.match(textOf(await request(on.port, 'GET', '/npm/lib@latest', BROWSER)), /<h1>lib@1\.10\.0<\/h1>/);
        assert.match(textOf(await request(on.port, 'GET', '/npm/lib@1.2', BROWSER)), /<h1>lib@1\.2\.0<\/h1>/);
        assert.match(textOf(await request(on.port, 'GET', '/npm/lib@1', BROWSER)), /<h1>lib@1\.10\.0<\/h1>/);
    });

    test('search from the page, an empty search listing every package and not being an error', async () => {
        const found = textOf(await request(on.port, 'GET', '/search?q=lib', BROWSER));
        assert.match(found, /<input type="search" name="q" value="lib"/);
        assert.match(found, /<a href="\/npm\/lib">npm\/lib<\/a>/);

        const blank = await request(on.port, 'GET', '/search', BROWSER);
        assert.equal(blank.status, 200);
        assert.match(textOf(blank), /<p class="lead">\d+ packages\.<\/p>/);
        assert.match(textOf(blank), /<a href="\/npm\/lib">npm\/lib<\/a>/);
        assert.match(textOf(blank), /<a href="\/bash\/gft">bash\/gft<\/a>/);

        const spaces = await request(on.port, 'GET', '/search?q=%20%20', BROWSER);
        assert.equal(spaces.status, 200);
        assert.match(textOf(spaces), /<a href="\/npm\/lib">npm\/lib<\/a>/);
        assert.equal((await request(on.port, 'GET', '/search', {})).status, 400);

        const hostile = textOf(await request(on.port, 'GET', '/search?q=%3Cscript%3E', BROWSER));
        assert.match(hostile, /value="&#60;script&#62;"/);
        assert.doesNotMatch(hostile, /<script/);
    });

    test('answer a path that does not exist with a page that names what is missing', async () => {
        const cases: [string, number, RegExp][] = [
            ['/nope', 404, /Package type &#39;nope&#39; does not exist\./],
            ['/npm/nope', 404, /Project &#39;nope&#39; does not exist in \/npm\./],
            ['/npm/lib@9.9.9', 404, /Version 9\.9\.9 does not exist in the &#39;lib&#39; project\./],
            ['/npm/lib@9/dist/', 404, /Version 9 does not exist/],
            ['/npm/lib/nope/x', 404, /Route &#39;\/npm\/lib\/nope\/x&#39; does not exist\./],
            ['/%E0', 400, /The path holds an invalid percent-encoding\./],
            ['/npm/lib@1.2.0/%3Cb%3E/', 404, undefined as never],
        ];

        for (const [path, status, message] of cases) {
            const reply = await request(on.port, 'GET', path, BROWSER);

            assert.equal(reply.status, status, path);
            if (message) {
                assert.match(String(reply.headers['content-type']), /^text\/html/, path);
                assert.match(textOf(reply), message, path);
            }
        }
    });

    test('keep the files raw, the checksums and the archives, and the missing files as JSON, for a browser too', async () => {
        const file = await request(on.port, 'GET', '/npm/lib@1.2.0/index.js', BROWSER);
        assert.equal(file.status, 200);
        assert.match(String(file.headers['content-type']), /javascript/);
        assert.equal(file.headers.vary, undefined);
        assert.equal(textOf(file), 'export default "1.2.0";\n');

        const sums = await request(on.port, 'GET', '/npm/lib@1.2.0?checksums', BROWSER);
        assert.match(String(sums.headers['content-type']), /^application\/json/);
        assert.equal(JSON.parse(textOf(sums)).algorithm, 'sha256');

        const archive = await request(on.port, 'GET', '/npm/lib@1.2.0?download', BROWSER);
        assert.match(String(archive.headers['content-type']), /gzip|tar/);

        const missing = await request(on.port, 'GET', '/npm/lib@1.2.0/missing.js', BROWSER);
        assert.equal(missing.status, 404);
        assert.match(String(missing.headers['content-type']), /^application\/json/);
        assert.equal(missing.headers.vary, undefined);
    });

    test('answer a HEAD with the headers of the page and no body', async () => {
        const get = await request(on.port, 'GET', '/npm/lib', BROWSER);
        const head = await request(on.port, 'HEAD', '/npm/lib', BROWSER);

        assert.equal(head.status, 200);
        assert.equal(head.body.length, 0);
        assert.equal(head.headers['content-length'], get.headers['content-length']);
        assert.equal(head.headers['content-type'], 'text/html; charset=utf-8');
        assert.equal(head.headers.vary, 'Accept');
    });

    test('count against the rate limit like any other answer', async () => {
        const limited = await startServer(fixture.packagesDir, {
            ui: PAGES,
            rateLimit: { window: 10, client: 2, global: null },
        });

        try {
            const headers = { ...BROWSER, 'x-test-client': '10.7.7.7' };
            const statuses = [];
            for (let n = 0; n < 3; n++) statuses.push((await request(limited.port, 'GET', '/', headers)).status);

            assert.deepEqual(statuses, [200, 200, 429]);
        } finally {
            await limited.stop();
        }
    });

    test('leave the answer to the JSON route for any method but GET and HEAD, whatever the client asks', async () => {
        for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
            for (const path of ['/', '/npm/lib', '/nope']) {
                const reply = await request(on.port, method, path, BROWSER);

                assert.match(String(reply.headers['content-type']), /^application\/json/, `${method} ${path}`);
                assert.ok(reply.status >= 400, `${method} ${path}`);
            }
        }
    });

    test('say that a JSON answer depends on Accept for an error, a HEAD and a folder, and not for a file', async () => {
        const error = await request(on.port, 'GET', '/nope', {});
        assert.equal(error.status, 404);
        assert.equal(error.headers.vary, 'Accept');

        const head = await request(on.port, 'HEAD', '/npm/lib', {});
        assert.match(String(head.headers['content-type']), /^application\/json/);
        assert.equal(head.headers.vary, 'Accept');

        const folder = await request(on.port, 'GET', '/npm/lib@1.2.0/dist/', { accept: 'application/json' });
        assert.equal(folder.headers.vary, 'Accept');

        const file = await request(on.port, 'GET', '/npm/lib@1.2.0/index.js', {});
        assert.equal(file.headers.vary, undefined);
    });

    test('show the version that the project resolves to in a search, not the highest', async () => {
        const html = textOf(await request(on.port, 'GET', '/search?q=lib', BROWSER));

        assert.match(
            html,
            /<a href="\/npm\/lib">npm\/lib<\/a><span class="dots"><\/span><span class="end">1\.10\.0<\/span>/,
        );
        assert.doesNotMatch(html, /2\.0\.0-pre/);
    });

    test('leave a README out, and log it, when it is too large or cannot be read', async () => {
        const failing = await startServer(
            fixture.packagesDir,
            { ui: PAGES },
            { read: () => Promise.reject(new Error('EIO: disk gone')) },
        );

        try {
            const reply = await request(failing.port, 'GET', '/bash/gft', BROWSER);

            assert.equal(reply.status, 200);
            assert.doesNotMatch(textOf(reply), /README/);
            assert.ok(
                failing.logs.errors.some((args) =>
                    String(args[0]).startsWith('README error on bash/gft/1.2.0/README.md'),
                ),
                JSON.stringify(failing.logs.errors),
            );
        } finally {
            await failing.stop();
        }
    });
});

/**
 * Makes a read port that reads real files only, records what it is asked and lies about one file.
 *
 * @param packagesDir - Packages folder the paths are relative to
 * @param reads - Receives each path asked
 * @returns The read port
 */
function readerOf(
    packagesDir: string,
    reads: string[],
): (path: string) => Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
    return async (path) => {
        reads.push(path);
        const full = join(packagesDir, path);
        if (fs.lstatSync(full).isSymbolicLink()) throw new Error('a link is not a real file');

        const bytes = path === 'docs/lying/1.0.0/README.md' ? Buffer.alloc(300000, 120) : fs.readFileSync(full);

        return new Response(new Uint8Array(bytes)).body!;
    };
}

describe('the README on a page', () => {
    const reads: string[] = [];
    let tree: DocsTree;
    let server: TestServer;

    before(async () => {
        tree = createDocsTree();
        server = await startServer(tree.packagesDir, { ui: PAGES }, { read: readerOf(tree.packagesDir, reads) });
    });

    after(async () => {
        await server?.stop();
        tree?.remove();
    });

    test('is rendered on the page of its version, with its relative addresses resolved against the version', async () => {
        const reply = await request(server.port, 'GET', '/docs/readme@1.0.0', BROWSER);
        const html = textOf(reply);

        assert.equal(reply.status, 200);
        assert.match(html, /<h2>README<\/h2>\n<h3 id="café">Café<\/h3>/);
        assert.ok(html.includes('href="/docs/readme@1.0.0/docs/guide.md"'));
        assert.ok(html.includes('href="/docs/readme@1.0.0/top"'));
        assert.ok(html.includes('src="/docs/readme@1.0.0/shot.png"'));
        assert.ok(html.includes('&#60;script&#62;alert(1)&#60;/script&#62;'));
        assert.doesNotMatch(html, /<script|\son[a-z]+=/i);
        assert.equal(reply.headers['content-length'], String(Buffer.byteLength(html)));
        assert.ok(Buffer.byteLength(html) > html.length);
    });

    test('is read through the real path of a link, as the file route does, and shown on the project page', async () => {
        reads.length = 0;
        const html = textOf(await request(server.port, 'GET', '/docs/readme', BROWSER));

        assert.match(html, /<h3 id="real-notes">Real notes<\/h3>/);
        assert.deepEqual(reads, ['docs/readme/2.0.0/notes/real.md']);
    });

    test('stays at the root of the version: a folder page has none', async () => {
        const html = textOf(await request(server.port, 'GET', '/docs/readme@1.0.0/docs/', BROWSER));

        assert.match(html, /<h1>readme@1\.0\.0\/docs<\/h1>/);
        assert.doesNotMatch(html, /README/);
    });

    test('answers a HEAD with the length of the page and no body', async () => {
        const get = await request(server.port, 'GET', '/docs/readme@1.0.0', BROWSER);
        const head = await request(server.port, 'HEAD', '/docs/readme@1.0.0', BROWSER);

        assert.equal(head.status, 200);
        assert.equal(head.body.length, 0);
        assert.equal(head.headers['content-length'], get.headers['content-length']);
    });

    test('is left out when the index says it is too large, without being read, and when its stream is', async () => {
        reads.length = 0;
        server.logs.errors.length = 0;

        const huge = await request(server.port, 'GET', '/docs/huge@1.0.0', BROWSER);
        assert.equal(huge.status, 200);
        assert.doesNotMatch(textOf(huge), /<h2>README<\/h2>/);
        assert.deepEqual(reads, []);
        assert.deepEqual(server.logs.errors, []);

        const lying = await request(server.port, 'GET', '/docs/lying@1.0.0', BROWSER);
        assert.equal(lying.status, 200);
        assert.doesNotMatch(textOf(lying), /<h2>README<\/h2>/);
        assert.deepEqual(server.logs.errors, [
            ['README error on docs/lying/1.0.0/README.md:', 'README is larger than 262144 bytes'],
        ]);
    });

    test('carry the Deprecation and Link headers of a deprecated project, on a page and on an error page', async () => {
        for (const path of ['/docs/old', '/docs/old@1.0.0', '/docs/old@9.9.9', '/docs/old/nope/x']) {
            const page = await request(server.port, 'GET', path, BROWSER);
            const data = await request(server.port, 'GET', path, {});

            assert.match(String(page.headers['content-type']), /^text\/html/, path);
            assert.ok(data.headers.deprecation, path);
            assert.equal(page.headers.deprecation, data.headers.deprecation, path);
            assert.equal(page.headers.link, data.headers.link, path);
        }

        const other = await request(server.port, 'GET', '/docs/readme', BROWSER);
        assert.equal(other.headers.deprecation, undefined);
    });

    test('name what is missing below a path, as the JSON error does', async () => {
        const cases: [string, RegExp][] = [
            ['/docs/old/nope/x', /Route &#39;\/docs\/old\/nope\/x&#39; does not exist\./],
            ['/docs/nope/x/y', /Project &#39;nope&#39; does not exist in \/docs\./],
            ['/zzz/x/y', /Package type &#39;zzz&#39; does not exist\./],
        ];

        for (const [path, message] of cases) {
            const page = await request(server.port, 'GET', path, BROWSER);
            const data = await request(server.port, 'GET', path, {});

            assert.equal(page.status, 404, path);
            assert.equal(data.status, 404, path);
            assert.match(textOf(page), message, path);
        }
    });
});

describe('the branded pages', () => {
    const SETTINGS = { accent: '#1d4ed8', logo: '/favicon.svg', favicon: '/favicon.ico', docs: false };
    let fixture: Fixture;
    let plain: TestServer;
    let branded: TestServer;

    before(async () => {
        fixture = createFixture();
        plain = await startServer(fixture.packagesDir, { ui: PAGES });
        branded = await startServer(fixture.packagesDir, { ui: SETTINGS });
    });

    after(async () => {
        await plain?.stop();
        await branded?.stop();
        fixture?.remove();
    });

    test('carry the style, the logo and the favicon of the config on every page, an error page included', async () => {
        for (const path of NEGOTIATED) {
            const html = textOf(await request(branded.port, 'GET', path, BROWSER));

            assert.ok(html.includes(`<style>${styleOf('#1d4ed8')}</style>`), path);
            assert.ok(html.includes('<link rel="icon" href="/favicon.ico">'), path);
            assert.ok(html.includes('<a class="brand" href="/"><img class="logo" src="/favicon.svg" alt="">'), path);
        }
    });

    test('keep the default look when the config sets nothing: the same style, no logo, no icon link', async () => {
        for (const path of NEGOTIATED) {
            const html = textOf(await request(plain.port, 'GET', path, BROWSER));

            assert.ok(html.includes(`<style>${STYLE}</style>`), path);
            assert.doesNotMatch(html, /<link|<img class="logo"/, path);
        }
    });

    test('keep the policy of a page as it is, since the logo and the icon are images of this site', async () => {
        const reply = await request(branded.port, 'GET', '/', BROWSER);

        assert.equal(reply.headers['content-security-policy'], POLICY);
    });

    test('serve the logo and the favicon as the assets that they are, to a browser as to anyone', async () => {
        for (const path of ['/favicon.svg', '/favicon.ico']) {
            const reply = await request(branded.port, 'GET', path, BROWSER);

            assert.equal(reply.status, 200, path);
            assert.doesNotMatch(String(reply.headers['content-type']), /html/, path);
        }
    });

    test('change the pages only: the JSON answers are the same as without settings', async () => {
        for (const path of ['/', '/npm/lib', '/search?q=lib', '/manifest']) {
            const [first, second] = [
                await request(plain.port, 'GET', path, { accept: 'application/json' }),
                await request(branded.port, 'GET', path, { accept: 'application/json' }),
            ];

            assert.equal(first.status, second.status, path);
            assert.equal(textOf(first), textOf(second), path);
        }
    });
});

describe('the docs', () => {
    const ACCEPTS: (string | undefined)[] = [BROWSER.accept, '*/*', undefined, 'application/json'];
    let fixture: Fixture;
    let tree: DocsTree;
    let on: TestServer;
    let off: TestServer;
    let none: TestServer;

    before(async () => {
        fixture = createFixture();
        tree = createDocsTree();
        on = await startServer(fixture.packagesDir, { ui: DOCS });
        off = await startServer(fixture.packagesDir, { ui: PAGES });
        none = await startServer(fixture.packagesDir);
    });

    after(async () => {
        await on?.stop();
        await off?.stop();
        await none?.stop();
        fixture?.remove();
        tree?.remove();
    });

    test('answer a page for every client at the index and at each page, without Vary since there is no JSON form', async () => {
        const paths = ['/-/docs', '/-/docs/', ...GUIDES.map(({ slug }) => `/-/docs/${slug}`)];

        for (const path of paths) {
            for (const accept of ACCEPTS) {
                const reply = await request(on.port, 'GET', path, accept === undefined ? {} : { accept });

                assert.equal(reply.status, 200, `${path} ${accept}`);
                assert.equal(reply.headers['content-type'], 'text/html; charset=utf-8', path);
                assert.equal(reply.headers.vary, undefined, path);
                assert.equal(reply.headers['cache-control'], 'public, max-age=300', path);
                assert.equal(reply.headers['content-security-policy'], POLICY, path);
                assert.equal(reply.headers['x-content-type-options'], 'nosniff', path);
                assert.equal(reply.headers['access-control-allow-origin'], '*', path);
                assert.equal(reply.headers['content-length'], String(reply.body.length), path);
            }
        }
    });

    test('answer a HEAD with the headers of the page and no body', async () => {
        for (const path of ['/-/docs', '/-/docs/config']) {
            const get = await request(on.port, 'GET', path, BROWSER);
            const head = await request(on.port, 'HEAD', path, BROWSER);

            assert.equal(head.status, 200, path);
            assert.equal(head.body.length, 0, path);
            assert.equal(head.headers['content-length'], get.headers['content-length'], path);
            assert.equal(head.headers['content-type'], 'text/html; charset=utf-8', path);
        }
    });

    test('show the overview at the index, each guide at its slug, and the list of the guides on every page', async () => {
        const index = textOf(await request(on.port, 'GET', '/-/docs', BROWSER));

        assert.match(index, /<h1 id="overview">Overview<\/h1>/);
        assert.ok(index.includes('<a href="/-/docs/overview" aria-current="page">Overview</a>'));

        for (const { slug, title } of GUIDES) {
            const html = textOf(await request(on.port, 'GET', `/-/docs/${slug}`, BROWSER));

            assert.match(html, new RegExp(`<h1 id="[^"]+">${title}</h1>`), slug);
            assert.equal(html.match(/aria-current="page"/g)?.length, 1, slug);
            for (const guide of GUIDES)
                assert.ok(html.includes(`<a href="/-/docs/${guide.slug}"`), `${slug} ${guide.slug}`);
            if (slug === 'overview') assert.ok(html.includes('All packages</a> / Docs</nav>'), slug);
            else assert.ok(html.includes('All packages</a> / <a href="/-/docs">Docs</a> / '), slug);
            assert.doesNotMatch(html, /<script|\son[a-z]+=/i, slug);
        }
    });

    test('write the links between the guides as paths of the docs, and the code samples as text', async () => {
        const html = textOf(await request(on.port, 'GET', '/-/docs/overview', BROWSER));

        assert.ok(html.includes('href="/-/docs/config"'));
        assert.ok(html.includes('href="/-/docs/routes"'));
        assert.ok(html.includes('<pre><code'));
    });

    test('are off unless ui.docs is true: a browser gets the page of an unknown route, the others the JSON', async () => {
        for (const path of ['/-/docs', '/-/docs/config']) {
            const page = await request(off.port, 'GET', path, BROWSER);
            const data = await request(off.port, 'GET', path, { accept: 'application/json' });

            assert.equal(page.status, 404, path);
            assert.equal(page.headers['content-type'], 'text/html; charset=utf-8', path);
            assert.equal(page.headers.vary, 'Accept', path);
            assert.match(textOf(page), /Route &#39;\/-\/docs/, path);
            assert.equal(data.status, 404, path);
            assert.match(String(data.headers['content-type']), /^application\/json/, path);
            assert.equal(data.headers.vary, 'Accept', path);
            assert.match(JSON.parse(textOf(data)).message, /^Route '\/-\/docs/, path);
        }
    });

    test('are not there without ui: the JSON of an unknown route, whoever asks, and no Vary', async () => {
        for (const path of ['/-/docs', '/-/docs/config']) {
            const reply = await request(none.port, 'GET', path, BROWSER);

            assert.equal(reply.status, 404, path);
            assert.match(String(reply.headers['content-type']), /^application\/json/, path);
            assert.equal(reply.headers.vary, undefined, path);
        }
    });

    test('answer an unknown page, a nested path and a trailing slash as a missing route, as a page or as JSON', async () => {
        for (const path of ['/-/docs/nope', '/-/docs/config/', '/-/docs/a/b', '/-/docs/%E0', '/-/docs/Config']) {
            const page = await request(on.port, 'GET', path, BROWSER);
            const data = await request(on.port, 'GET', path, { accept: 'application/json' });

            assert.ok([400, 404].includes(page.status), path);
            assert.equal(page.headers['content-type'], 'text/html; charset=utf-8', path);
            assert.equal(page.headers.vary, 'Accept', path);
            assert.equal(data.status, page.status, path);
            assert.match(String(data.headers['content-type']), /^application\/json/, path);
        }
    });

    test('leave the other methods to the JSON route, which refuses them', async () => {
        for (const method of ['POST', 'PUT', 'DELETE']) {
            const reply = await request(on.port, method, '/-/docs', BROWSER);

            assert.equal(reply.status, 405, method);
            assert.match(String(reply.headers['content-type']), /^application\/json/, method);
        }
    });

    test('carry the accent, the logo and the favicon of the config, like every page', async () => {
        const branded = await startServer(fixture.packagesDir, {
            ui: { accent: '#1d4ed8', logo: '/favicon.svg', favicon: '/favicon.ico', docs: true },
        });

        try {
            const html = textOf(await request(branded.port, 'GET', '/-/docs/config', BROWSER));

            assert.ok(html.includes(`<style>${styleOf('#1d4ed8')}</style>`));
            assert.ok(html.includes('<img class="logo" src="/favicon.svg" alt="">'));
            assert.ok(html.includes('<link rel="icon" href="/favicon.ico">'));
        } finally {
            await branded.stop();
        }
    });

    test('count against the rate limit like any other answer', async () => {
        const limited = await startServer(fixture.packagesDir, {
            ui: DOCS,
            rateLimit: { window: 10, client: 2, global: null },
        });

        try {
            const headers = { 'x-test-client': 'docs-limit' };
            const statuses = [];
            for (let count = 0; count < 3; count++) {
                statuses.push((await request(limited.port, 'GET', '/-/docs', headers)).status);
            }

            assert.deepEqual(statuses, [200, 200, 429]);
        } finally {
            await limited.stop();
        }
    });

    test('link to the docs from the front page when they are on, and not when they are off', async () => {
        const home = textOf(await request(on.port, 'GET', '/', BROWSER));
        const bare = textOf(await request(off.port, 'GET', '/', BROWSER));

        assert.ok(home.includes('<a href="/-/docs">Docs</a>'));
        assert.doesNotMatch(bare, /\/-\/docs/);
    });

    test('leave a type named docs alone: its pages, its README and its files are served as before', async () => {
        const server = await startServer(tree.packagesDir, { ui: DOCS });

        try {
            const type = await request(server.port, 'GET', '/docs', BROWSER);
            const project = await request(server.port, 'GET', '/docs/readme@1.0.0', BROWSER);
            const file = await request(server.port, 'GET', '/docs/old@1.0.0/index.js', BROWSER);

            assert.equal(type.status, 200);
            assert.match(textOf(type), /<h1>docs<\/h1>/);
            assert.match(textOf(project), /<h2>README<\/h2>/);
            assert.equal(file.status, 200);
            assert.equal(textOf(file), 'export default 1;\n');
        } finally {
            await server.stop();
        }
    });

    test('keep the pages and the JSON of every other path as they are, docs on or off', async () => {
        for (const path of ['/', '/npm', '/npm/lib', '/search?q=lib']) {
            const [first, second] = [
                await request(on.port, 'GET', path, BROWSER),
                await request(off.port, 'GET', path, BROWSER),
            ];

            assert.equal(first.status, second.status, path);
            assert.equal(first.headers.vary, 'Accept', path);
        }
    });
});
