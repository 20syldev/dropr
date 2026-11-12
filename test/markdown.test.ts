import assert from 'assert/strict';
import { describe, test } from 'node:test';

import { renderMarkdown } from '../dist/lib/markdown.js';

import { mulberry32 } from './random.ts';

// Elements that the renderer may write, with the attributes each may carry
const ALLOWED: Record<string, string[]> = {
    a: ['href', 'title', 'rel'],
    img: ['src', 'alt', 'title', 'loading', 'referrerpolicy'],
    h1: ['id'],
    h2: ['id'],
    h3: ['id'],
    h4: ['id'],
    h5: ['id'],
    h6: ['id'],
    ol: ['start'],
    code: ['class'],
    th: ['class'],
    td: ['class'],
    p: [],
    ul: [],
    li: [],
    em: [],
    strong: [],
    del: [],
    pre: [],
    blockquote: [],
    table: [],
    thead: [],
    tbody: [],
    tr: [],
    hr: [],
    br: [],
};

/**
 * Checks that HTML holds only the elements and attributes the renderer writes, with addresses that are safe.
 * Text is escaped, so a literal < always opens an element and an attribute value never holds a quote.
 *
 * @param html - Output of renderMarkdown
 * @returns The first fault found, or null when the HTML is sound
 */
function fault(html: string): string | null {
    if (/[<>"']/.test(html.replace(/<\/?[a-z0-9]+(?: [a-z]+="[^"<>]*")*>/g, '')))
        return 'a mark is left outside an element';

    for (const [tag, name, value] of [...html.matchAll(/<([a-z0-9]+)((?: [a-z]+="[^"<>]*")*)>/g)].flatMap((match) => {
        const attributes = [...match[2].matchAll(/ ([a-z]+)="([^"<>]*)"/g)];

        return attributes.length > 0 ? attributes.map((a) => [match[1], a[1], a[2]]) : [[match[1], '', '']];
    })) {
        if (!(tag in ALLOWED)) return `element ${tag}`;
        if (name !== '' && !ALLOWED[tag].includes(name)) return `attribute ${name} on ${tag}`;
        if ((name === 'href' || name === 'src') && !/^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(value))
            return `address ${value}`;
    }

    return null;
}

/**
 * Renders a document and checks that the output is sound.
 *
 * @param source - Markdown text
 * @param options - Options of renderMarkdown
 * @returns The HTML
 */
function render(source: string, options?: Parameters<typeof renderMarkdown>[1]): string {
    const html = renderMarkdown(source, options);
    assert.equal(fault(html), null, `${JSON.stringify(source)} gave ${html}`);

    return html;
}

describe('renderMarkdown', () => {
    test('writes headings with an id, an offset, and setext forms', () => {
        assert.equal(render('# Hello, World!'), '<h1 id="hello-world">Hello, World!</h1>\n');
        assert.equal(render('## A\n\n## A'), '<h2 id="a">A</h2>\n<h2 id="a-1">A</h2>\n');
        assert.equal(render('# Up', { offset: 1 }), '<h2 id="up">Up</h2>\n');
        assert.equal(render('###### Deep', { offset: 3 }), '<h6 id="deep">Deep</h6>\n');
        assert.equal(render('Title\n=====\nSub\n---'), '<h1 id="title">Title</h1>\n<h2 id="sub">Sub</h2>\n');
        assert.equal(render('#hashtag'), '<p>#hashtag</p>\n');
        assert.equal(render('# Closed ##'), '<h1 id="closed">Closed</h1>\n');
        assert.equal(render('#'), '<h1 id="section"></h1>\n');
    });

    test('writes paragraphs, emphasis, strikethrough, code and escapes', () => {
        assert.equal(render('one\ntwo'), '<p>one\ntwo</p>\n');
        assert.equal(
            render('a *b* **c** ~~d~~ `e <f>`'),
            '<p>a <em>b</em> <strong>c</strong> <del>d</del> <code>e &#60;f&#62;</code></p>\n',
        );
        assert.equal(render('snake_case_word and 2 * 3 * 4'), '<p>snake_case_word and 2 * 3 * 4</p>\n');
        assert.equal(render('\\*not\\* \\<b\\>'), '<p>*not* &#60;b&#62;</p>\n');
        assert.equal(render('line  \nbreak'), '<p>line<br>\nbreak</p>\n');
        assert.equal(render('a & b "q" \'s\''), '<p>a &#38; b &#34;q&#34; &#39;s&#39;</p>\n');
    });

    test('writes lists, nested lists, ordered lists from a number, and loose items', () => {
        assert.equal(render('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n');
        assert.equal(render('3. a\n4. b'), '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>\n');
        assert.equal(render('- a\n  - b\n- c'), '<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n<li>c</li>\n</ul>\n');
        assert.equal(render('- a\n\n- b'), '<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>\n');
        assert.equal(
            render('1. a\n\n   code?\n2. b'),
            '<ol>\n<li><p>a</p>\n<p>code?</p></li>\n<li><p>b</p></li>\n</ol>\n',
        );
        assert.equal(render('- a\ncontinued'), '<ul>\n<li>a\ncontinued</li>\n</ul>\n');
    });

    test('writes quotes, rules, fenced code with a language, and indented code', () => {
        assert.equal(
            render('> a\n> b\n\n> c'),
            '<blockquote>\n<p>a\nb</p>\n</blockquote>\n<blockquote>\n<p>c</p>\n</blockquote>\n',
        );
        assert.equal(render('---\n***\n___'), '<hr>\n<hr>\n<hr>\n');
        assert.equal(
            render('```ts\nlet a = "<b>";\n```'),
            '<pre><code class="language-ts">let a = &#34;&#60;b&#62;&#34;;\n</code></pre>\n',
        );
        assert.equal(render('~~~\nraw **text**\n~~~'), '<pre><code>raw **text**\n</code></pre>\n');
        assert.equal(render('```wei"rd\ncode\n```'), '<pre><code>code\n</code></pre>\n');
        assert.equal(render('    indented\n    more'), '<pre><code>indented\nmore\n</code></pre>\n');
        assert.equal(render('```\nunclosed'), '<pre><code>unclosed\n</code></pre>\n');
    });

    test('writes tables with their alignment and pads short rows', () => {
        assert.equal(
            render('| a | b |\n|:-:|--:|\n| 1 |\n| 2 | 3 | 4 |'),
            '<table><thead><tr><th class="center">a</th><th class="right">b</th></tr></thead>' +
                '<tbody><tr><td class="center">1</td><td class="right"></td></tr>' +
                '<tr><td class="center">2</td><td class="right">3</td></tr></tbody></table>\n',
        );
        assert.equal(render('a | b\n- | -'), '<table><thead><tr><th>a</th><th>b</th></tr></thead></table>\n');
        assert.equal(
            render('| a |\n|---|\n| x \\| y |'),
            '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>x | y</td></tr></tbody></table>\n',
        );
    });

    test('follows http, https and mailto links only, and rel marks the ones that leave', () => {
        const external = ' rel="noopener noreferrer nofollow"';

        assert.equal(
            render('[a](https://x.y/z?q=1&r=2 "T")'),
            `<p><a href="https://x.y/z?q=1&#38;r=2" title="T"${external}>a</a></p>\n`,
        );
        assert.equal(render('[m](mailto:a@b.c)'), '<p><a href="mailto:a@b.c">m</a></p>\n');
        assert.equal(
            render('<https://x.y> and https://x.y/p, ok'),
            `<p><a href="https://x.y"${external}>https://x.y</a> and <a href="https://x.y/p"${external}>https://x.y/p</a>, ok</p>\n`,
        );
        assert.equal(render('[top](#top)'), '<p><a href="#top">top</a></p>\n');

        for (const bad of [
            'javascript:alert(1)',
            'JaVaScRiPt:alert(1)',
            'data:text/html,x',
            'vbscript:x',
            '//evil.example',
            'java\tscript:x',
            ' javascript:x',
        ]) {
            assert.equal(render(`[x](<${bad}>)`), '<p>x</p>\n', bad);
        }
    });

    test('resolves relative addresses against the base folder, without leaving the origin', () => {
        const base = { base: '/npm/lib@1.0.0/' };

        assert.equal(render('[a](docs/a.md)', base), '<p><a href="/npm/lib@1.0.0/docs/a.md">a</a></p>\n');
        assert.equal(render('[a](./a.md?x=1#h)', base), '<p><a href="/npm/lib@1.0.0/a.md?x=1#h">a</a></p>\n');
        assert.equal(render('[a](/root.md)', base), '<p><a href="/npm/lib@1.0.0/root.md">a</a></p>\n');
        assert.equal(render('[a](../../..//evil.example/x)', base), '<p><a href="/evil.example/x">a</a></p>\n');
        assert.equal(
            render('![i](logo.svg)', base),
            '<p><img src="/npm/lib@1.0.0/logo.svg" alt="i" loading="lazy" referrerpolicy="no-referrer"></p>\n',
        );
        assert.equal(render('[a](x)'), '<p><a href="/x">a</a></p>\n');
    });

    test('writes images as such, refuses mailto and fragments for them, and nests them in links', () => {
        assert.equal(render('![a](mailto:x@y.z)'), '<p>a</p>\n');
        assert.equal(render('![a](#x)'), '<p>a</p>\n');
        assert.equal(
            render('![a <b>](https://x.y/i.png "t")'),
            '<p><img src="https://x.y/i.png" alt="a &#60;b&#62;" title="t" loading="lazy" referrerpolicy="no-referrer"></p>\n',
        );
        assert.equal(
            render('[![b](https://x.y/b.svg)](https://x.y)'),
            '<p><a href="https://x.y" rel="noopener noreferrer nofollow"><img src="https://x.y/b.svg" alt="b" loading="lazy" referrerpolicy="no-referrer"></a></p>\n',
        );
    });

    test('reads reference definitions, case blind, and leaves them out of the text', () => {
        const html = render('See [Foo] and [the text][FOO] and [none].\n\n[foo]: https://x.y "Title"\n');

        assert.equal(
            html,
            '<p>See <a href="https://x.y" title="Title" rel="noopener noreferrer nofollow">Foo</a> and <a href="https://x.y" title="Title" rel="noopener noreferrer nofollow">the text</a> and [none].</p>\n',
        );
        assert.equal(render('```\n[a]: https://x.y\n```'), '<pre><code>[a]: https://x.y\n</code></pre>\n');
    });

    test('writes raw HTML as text, and drops comments', () => {
        assert.equal(render('<script>alert(1)</script>'), '<p>&#60;script&#62;alert(1)&#60;/script&#62;</p>\n');
        assert.equal(render('<img src=x onerror=alert(1)>'), '<p>&#60;img src=x onerror=alert(1)&#62;</p>\n');
        assert.equal(render('<!-- hidden -->\nvisible'), '<p>visible</p>\n');
        assert.equal(render('a <!-- hidden --> b'), '<p>a  b</p>\n');
        assert.equal(render('<!--\nmulti\nline\n-->\nvisible'), '<p>visible</p>\n');
        assert.equal(
            render('<a href="javascript:alert(1)">x</a>'),
            '<p>&#60;a href=&#34;javascript:alert(1)&#34;&#62;x&#60;/a&#62;</p>\n',
        );
    });

    test('accepts any line ending and tab, and an empty document', () => {
        assert.equal(render(''), '');
        assert.equal(render('a\r\nb\rc'), '<p>a\nb\nc</p>\n');
        assert.equal(render('\tcode'), '<pre><code>code\n</code></pre>\n');
    });

    test('nests emphasis the way it reads, a single mark never closing on half of a pair', () => {
        const cases: [string, string][] = [
            ['*a **b** c*', '<p><em>a <strong>b</strong> c</em></p>\n'],
            ['***a***', '<p><strong><em>a</em></strong></p>\n'],
            ['**bold *it***', '<p><strong>bold <em>it</em></strong></p>\n'],
            ['*it **bold***', '<p><em>it <strong>bold</strong></em></p>\n'],
            ['_**a**_', '<p><em><strong>a</strong></em></p>\n'],
            ['~~**a**~~', '<p><del><strong>a</strong></del></p>\n'],
            ['*a* *b*', '<p><em>a</em> <em>b</em></p>\n'],
        ];

        for (const [source, html] of cases) assert.equal(render(source), html, source);
    });

    test('reads a tab as the spaces up to the next tab stop, so that items and code keep their shape', () => {
        assert.equal(render('-\ta\n\n\tb'), '<ul>\n<li><p>a</p>\n<p>b</p></li>\n</ul>\n');
        assert.equal(render('- a\n\t- b'), '<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n</ul>\n');
        assert.equal(render('a\tb'), '<p>a   b</p>\n');
    });

    test('starts a table in the middle of a paragraph, and ends a quote at the next block', () => {
        assert.equal(
            render('intro\n| a | b |\n|---|---|\n| 1 | 2 |'),
            '<p>intro</p>\n<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>\n',
        );
        assert.equal(
            render('> a\n# h\n- x'),
            '<blockquote>\n<p>a</p>\n</blockquote>\n<h1 id="h">h</h1>\n<ul>\n<li>x</li>\n</ul>\n',
        );
        assert.equal(render('> a\nb'), '<blockquote>\n<p>a\nb</p>\n</blockquote>\n');
        assert.equal(render('> a\n>\nb'), '<blockquote>\n<p>a</p>\n</blockquote>\n<p>b</p>\n');
    });

    test('decodes the character references it knows, escapes the result, and leaves code alone', () => {
        assert.equal(render('&amp; &copy; &#169; &#x1F600;'), '<p>&#38; © © \u{1F600}</p>\n');
        assert.equal(render('&lt;b&gt; &quot;'), '<p>&#60;b&#62; &#34;</p>\n');
        assert.equal(
            render('&bogus; &#0; &#xD800; &#1114112;'),
            '<p>&#38;bogus; &#38;#0; &#38;#xD800; &#38;#1114112;</p>\n',
        );
        assert.equal(render('`&amp;`'), '<p><code>&#38;amp;</code></p>\n');
        assert.equal(fault(render('&lt;script&gt;alert(1)&lt;/script&gt; &#60;img&#62;')), null);
    });

    test('makes the ids of the headings the way GitHub does, so that the links to a section hold', () => {
        const ids = (source: string): string[] => [...render(source).matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);

        assert.deepEqual(ids('## Hello, World!'), ['hello-world']);
        assert.deepEqual(ids('## A  B'), ['a--b']);
        assert.deepEqual(ids('## [Link](http://x.y) text'), ['link-text']);
        assert.deepEqual(ids('## Café snake_case'), ['café-snake_case']);
        assert.deepEqual(ids('## \u{1F680} Go\n## x\n## x'), ['-go', 'x', 'x-1']);
        assert.deepEqual(ids('## !!!'), ['section']);
    });

    test('escapes the title of a link and of an image, and refuses an address with a backslash', () => {
        const link = render('[a](https://x.y \'t"onmouseover="x\')');
        const image = render('![a](https://x.y/i.png \'t"onerror="x\')');

        assert.ok(link.includes('title="t&#34;onmouseover=&#34;x"'), link);
        assert.ok(image.includes('title="t&#34;onerror=&#34;x"'), image);
        assert.equal(fault(link), null);
        assert.equal(fault(image), null);
        assert.equal(render('[a](/\\evil.com)'), '<p>a</p>\n');
        assert.equal(render('[a](\\\\evil.com)'), '<p>a</p>\n');
    });

    test('opens a fence on a run of backticks or tildes, and reads the language from its first word', () => {
        assert.equal(render('~~~\ncode\n~~~'), '<pre><code>code\n</code></pre>\n');
        assert.equal(render('``` js extra\nx\n```'), '<pre><code class="language-js">x\n</code></pre>\n');
        assert.equal(render('~~~ a`b\nx\n~~~'), '<pre><code>x\n</code></pre>\n');
        assert.equal(render('``` a`b\nx'), '<p>``` a`b\nx</p>\n');
    });

    test('does not read past its limits, and stays fast on hostile input', () => {
        const hostile = [
            '['.repeat(9000),
            '[a]('.repeat(2000),
            '*'.repeat(9000) + 'a',
            '`'.repeat(9000),
            '> '.repeat(5000) + 'x',
            '- '.repeat(5000) + 'x',
            ' '.repeat(5000) + '|',
            '| a |\n' + '|' + ' '.repeat(4900) + '-',
            '# ' + ' '.repeat(4900) + '#',
            '_'.repeat(9000),
            '![['.repeat(3000),
            '<'.repeat(9000),
            `${'x'.repeat(300000)}`,
            'a\n'.repeat(130000),
            '1. '.repeat(3000),
            '    '.repeat(2000) + 'x',
            '~'.repeat(4900) + '`',
            `${'~'.repeat(4900)}\`\n`.repeat(50),
            `${'*a '.repeat(3300)}\n\n`.repeat(26),
            `${'_a '.repeat(3300)}\n\n`.repeat(26),
            `${'**a *b _c ~~d '.repeat(700)}\n\n`.repeat(26),
            `${'['.repeat(9000)}\n\n`.repeat(28),
            `${'[a](<'.repeat(2000)}\n\n`.repeat(28),
            `${'`a ``b ```c '.repeat(800)}\n\n`.repeat(26),
            '&#1;&amp;&bogus;'.repeat(15000),
        ];

        for (const source of hostile) {
            const start = Date.now();
            const html = render(source);

            assert.ok(Date.now() - start < 1500, `${source.slice(0, 20)} took ${Date.now() - start} ms`);
            assert.ok(html.length < 3_000_000);
        }
    });

    test('writes only allowed elements and addresses, whatever the mix of syntax', () => {
        const parts = [
            '#',
            '##',
            '- ',
            '1. ',
            '> ',
            '```',
            '~~~',
            '*',
            '**',
            '_',
            '~~',
            '`',
            '[',
            ']',
            '(',
            ')',
            '![',
            '](',
            '<',
            '>',
            '<!--',
            '-->',
            '|',
            ':',
            '---',
            '\\',
            '&',
            '"',
            "'",
            'javascript:',
            'https://x.y',
            'a',
            'b c',
            '\n',
            '\n\n',
            '  ',
            '    ',
            '[a]: x',
            '[a]',
            '<b>',
            'onerror=',
        ];
        const next = mulberry32(20241112);

        for (let round = 0; round < 3000; round++) {
            const length = 1 + Math.floor(next() * 40);
            let source = '';
            for (let n = 0; n < length; n++) source += parts[Math.floor(next() * parts.length)];

            render(source, round % 2 === 0 ? { base: '/npm/lib@1.0.0/', offset: 1 } : undefined);
        }
    });
});
