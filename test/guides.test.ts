import assert from 'assert/strict';
import fs from 'fs';
import { after, describe, test } from 'node:test';
import os from 'os';
import { join } from 'path';

import { parseConfig } from '../dist/lib/config.js';
import { GUIDES } from '../dist/lib/guides.js';
import { renderMarkdown } from '../dist/lib/markdown.js';
import { RESERVED } from '../dist/lib/router.js';
import { ROUTES } from '../dist/manifest.js';

import { readGuides, render } from '../scripts/docs.ts';
import { rootDir } from './server.ts';

/**
 * Writes the files of a folder of guides, the folder being created.
 *
 * @param files - Content of each file by name
 * @returns The folder, and a function that removes the files and the folder
 */
function makeFolder(files: Record<string, string>): { dir: string; remove: () => void } {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'dropr-guides-'));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(join(dir, name), text);

    return {
        dir,
        remove: () => {
            for (const name of fs.readdirSync(dir)) fs.unlinkSync(join(dir, name));
            fs.rmdirSync(dir);
        },
    };
}

describe('readGuides', () => {
    const folders: (() => void)[] = [];
    const open = (files: Record<string, string>): string => {
        const { dir, remove } = makeFolder(files);
        folders.push(remove);

        return dir;
    };

    after(() => folders.forEach((remove) => remove()));

    test('reads each file in the order of its number, with the slug after the number and the first heading as title', () => {
        const dir = open({
            '10-last.md': '# Last one\n\nText.\n',
            '2-config.md': 'Intro line.\n\n# The config\n\n## Not the title\n',
            '1-overview.md': '# Overview\n',
            'notes.txt': 'not a guide',
        });

        assert.deepEqual(readGuides(dir), [
            { slug: 'overview', title: 'Overview', markdown: '# Overview\n' },
            { slug: 'config', title: 'The config', markdown: 'Intro line.\n\n# The config\n\n## Not the title\n' },
            { slug: 'last', title: 'Last one', markdown: '# Last one\n\nText.\n' },
        ]);
    });

    test('takes the title from the first heading outside a code block, whatever the fence is', () => {
        const dir = open({
            '1-a.md': '```bash\n# a comment\n```\n\n# Real title\n',
            '2-b.md': '~~~\n# tilde comment\n~~~\n# Other title\n',
            '3-c.md': '````md\n```\n# nested\n```\n````\n# Third title\n',
        });

        assert.deepEqual(
            readGuides(dir).map(({ title }) => title),
            ['Real title', 'Other title', 'Third title'],
        );
    });

    test('refuses a name without a number, a slug that is not lower case, a duplicate slug and a file with no title', () => {
        const cases: [Record<string, string>, RegExp][] = [
            [{ 'overview.md': '# A\n' }, /overview\.md.*number/],
            [{ '1-Over_view.md': '# A\n' }, /1-Over_view\.md.*slug/],
            [{ '1-a.md': '# A\n', '2-a.md': '# B\n' }, /slug a is used twice/],
            [{ '1-a.md': 'no heading\n' }, /1-a\.md.*title/],
            [{ '1-a.md': '' }, /1-a\.md.*title/],
            [{ '1-a.md': '## Second level only\n' }, /1-a\.md.*title/],
            [{ '1-a.md': '```bash\n# a comment\n```\n' }, /1-a\.md.*title/],
            [{ '1-b.md': '# B\n', '01-a.md': '# A\n' }, /number 1 is used twice/],
        ];

        for (const [files, message] of cases) assert.throws(() => readGuides(open(files)), message);
    });
});

/**
 * Reads back the guides that render wrote, the way a person reads the file: a string a line.
 *
 * @param text - Source written by render
 * @returns The guides it holds
 */
function readBack(text: string): { slug: string; title: string; markdown: string }[] {
    const guides: { slug: string; title: string; lines: string[] }[] = [];

    for (const line of text.split('\n')) {
        const field = /^ {8}(slug|title): ([\s\S]*),$/.exec(line);
        const piece = /^ {12}("[\s\S]*"),$/.exec(line);

        if (field?.[1] === 'slug') guides.push({ slug: JSON.parse(field[2]), title: '', lines: [] });
        else if (field) guides[guides.length - 1].title = JSON.parse(field[2]);
        else if (piece) guides[guides.length - 1].lines.push(JSON.parse(piece[1]));
    }

    return guides.map(({ slug, title, lines }) => ({ slug, title, markdown: lines.join('\n') }));
}

describe('render', () => {
    const HOSTILE = [
        '# Title',
        '',
        'Quotes " \' ` and a backslash \\ and ${not.interpolated} and </script> and   and \u{1f600}.',
        'import fs from "node:fs";',
        'export default 1;',
        '',
        '    indented',
        '',
    ].join('\r\n');

    test('writes each line of a guide on a line of its own, so that every guide reads back as it was', () => {
        const guides = [
            { slug: 'one', title: 'Title', markdown: HOSTILE },
            { slug: 'two', title: 'Two', markdown: '# Two\n' },
            { slug: 'three', title: 'Three', markdown: '# Three' },
            { slug: 'four', title: 'Four', markdown: '\n\n# Four\n\n\n' },
        ];
        const text = render(guides);

        assert.deepEqual(readBack(text), guides);
        assert.equal(text.split('\n').filter((line) => line.startsWith('            "')).length, 8 + 2 + 1 + 6);
    });

    test('leaves no line that starts with import or export but the two of its own, whatever the text says', () => {
        const text = render([{ slug: 'one', title: 'Title', markdown: HOSTILE }]);
        const lines = text.split('\n').filter((line) => /^(import|export)\b/.test(line));

        assert.deepEqual(lines, [
            "import type { Guide } from '../types/index.js';",
            'export const GUIDES: Guide[] = [',
        ]);
        assert.ok(text.startsWith('// Generated by scripts/docs.ts from docs/*.md'));
        assert.ok(text.endsWith('];\n'));
    });

    test('changes one line of the file for one line of a guide, so that a diff reads as the docs do', () => {
        const before = render([{ slug: 'a', title: 'A', markdown: '# A\n\nOne.\n\nTwo.\n' }]).split('\n');
        const after = render([{ slug: 'a', title: 'A', markdown: '# A\n\nOne!\n\nTwo.\n' }]).split('\n');
        const changed = before.filter((line, index) => line !== after[index]);

        assert.equal(before.length, after.length);
        assert.deepEqual(changed, ['            "One.",']);
    });
});

/**
 * Finds a guide of the docs.
 *
 * @param slug - Slug of the guide
 * @returns The guide, which the test fails without
 */
function guide(slug: string): { slug: string; title: string; markdown: string } {
    const found = GUIDES.find((entry) => entry.slug === slug);
    assert.ok(found, slug);

    return found;
}

/**
 * Lists the keys that the config parser knows, read from the source of the parser.
 *
 * @returns The dotted path of every key whose section lists its keys in a literal
 */
function configKeys(): string[] {
    const source = fs.readFileSync(join(rootDir, 'src', 'lib', 'config.ts'), 'utf-8');
    const keys: string[] = [];

    for (const [, path, list] of source.matchAll(/section\(\s*[^,]+,\s*'([^']*)',\s*\[([^\]]*)\]/g)) {
        for (const [, name] of list.matchAll(/'([^']+)'/g)) keys.push(path ? `${path}.${name}` : name);
    }

    return keys;
}

describe('the guides of dropr', () => {
    test('are the ones written in docs/, as the generated module holds them', () => {
        assert.deepEqual(GUIDES, readGuides(join(rootDir, 'docs')));
    });

    test('have a unique slug each and a title, and start with the overview', () => {
        const slugs = GUIDES.map(({ slug }) => slug);

        assert.equal(new Set(slugs).size, slugs.length);
        assert.deepEqual(slugs.slice(0, 3), ['overview', 'config', 'routes']);
        for (const { title, markdown } of GUIDES) assert.ok(markdown.includes(`# ${title}`), title);
    });

    test('write every key that the config parser knows, so that a new key cannot go undocumented', () => {
        const keys = configKeys();
        const { markdown } = guide('config');

        assert.ok(keys.length >= 15, keys.join());
        for (const key of ['ui.accent', 'ui.logo', 'ui.favicon', 'ui.docs', 'rateLimit.global', 'clientIp.header']) {
            assert.ok(keys.includes(key), key);
        }
        for (const key of [...keys, 'ui']) {
            assert.ok(markdown.includes(`\`${key}\``) || markdown.includes(`\`${key}.`), key);
        }
    });

    test('hold config samples that the parser accepts', () => {
        let samples = 0;

        for (const { markdown } of GUIDES) {
            for (const [, text] of markdown.matchAll(/```json\n([\s\S]*?)```/g)) {
                assert.doesNotThrow(() => parseConfig(JSON.parse(text)), text);
                samples++;
            }
        }
        assert.ok(samples >= 1);
    });

    test('list every route of the manifest, and every name that a type cannot take', () => {
        const { markdown } = guide('routes');

        for (const { path } of ROUTES) {
            const written = path.replaceAll('{file}', '<path>').replaceAll(/\{(\w+)\}/g, '<$1>');

            assert.ok(markdown.includes(`\`${written}\``) || markdown.includes(written), written);
        }
        for (const name of RESERVED) assert.ok(markdown.includes(`\`${name}\``), name);
        assert.ok(markdown.includes('/-/docs'));
    });

    test('link to each other by slug only, to pages and to headings that exist', () => {
        const ids = new Map<string, string[]>();
        const links: [string, string][] = [];

        for (const { slug, markdown } of GUIDES) {
            const html = renderMarkdown(markdown, { base: '/-/docs/', offset: 1 });

            ids.set(
                slug,
                [...html.matchAll(/ id="([^"]+)"/g)].map(([, id]) => id),
            );
            for (const [, href] of html.matchAll(/ href="([^"]*)"/g)) links.push([slug, href]);
        }

        assert.ok(links.length > 0);
        for (const [from, href] of links) {
            if (href.startsWith('https://') || href.startsWith('http://')) continue;
            const [, page, id] = /^\/-\/docs\/([a-z0-9-]*)(?:#(.+))?$/.exec(href) ?? [];

            assert.notEqual(page, undefined, `${from} links to ${href}`);
            const target = page === '' ? from : page;
            assert.ok(ids.has(target), `${from} links to the page ${target}`);
            if (id) assert.ok(ids.get(target)!.includes(id), `${from} links to ${href}`);
        }
    });

    test('are plain ASCII and name no host of the instance', () => {
        for (const { slug, markdown } of GUIDES) {
            assert.doesNotMatch(markdown, /[^\t\n -~]/, slug);
            assert.doesNotMatch(markdown, /\b(render|cloudflare|netlify|vercel|heroku)\b/i, slug);
        }
    });
});
