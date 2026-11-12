import assert from 'assert/strict';
import { describe, test } from 'node:test';

import { STYLE } from '../dist/lib/style.js';
import { SURFACES, contrast, styleOf, uiOf } from '../dist/lib/theme.js';

import { mulberry32 } from './random.ts';

/**
 * Reads the colors a theme sets for one scheme.
 *
 * @param css - Result of styleOf
 * @param scheme - light for the first block, dark for the one under the media query
 * @returns The accent, the color of the links, the color of the focus ring and the ink of the buttons
 */
function tokens(css: string, scheme: 'light' | 'dark'): { accent: string; text: string; ring: string; ink: string } {
    const own = css.slice(STYLE.length);
    const block = scheme === 'light' ? own.split('@media')[0] : own.split('@media')[1];
    const found =
        /--accent: (#[0-9a-f]{6}); --accent-text: (#[0-9a-f]{6}); --ring: (#[0-9a-f]{6}); --accent-ink: (#[0-9a-f]{6});/.exec(
            block,
        );
    assert.ok(found, `${scheme} block of ${own}`);

    return { accent: found[1], text: found[2], ring: found[3], ink: found[4] };
}

/**
 * Gives the lowest contrast of a color on a list of backgrounds.
 *
 * @param color - Text or fill color
 * @param backgrounds - Colors it sits on
 * @returns The lowest ratio
 */
function lowest(color: string, backgrounds: string[]): number {
    return Math.min(...backgrounds.map((background) => contrast(color, background)));
}

describe('contrast', () => {
    test('follows WCAG: 21 for black on white, 1 for a color on itself, and about 4.5 for #767676 on white', () => {
        assert.equal(contrast('#000000', '#ffffff'), 21);
        assert.equal(contrast('#ffffff', '#000000'), 21);
        assert.equal(contrast('#336699', '#336699'), 1);
        assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01);
    });
});

describe('the surfaces of the theme', () => {
    test('are the colors of the style sheet, so that a change of the sheet fails here', () => {
        const dark = STYLE.slice(STYLE.indexOf('@media (prefers-color-scheme: dark)'));
        const light = STYLE.slice(0, STYLE.indexOf('@media (prefers-color-scheme: dark)'));
        const [bg, surface, note] = ['--bg', '--surface', '--dep-bg'];

        assert.deepEqual(
            SURFACES.light,
            [bg, surface, note].map((name) => new RegExp(`${name}: (#[0-9a-f]{6})`).exec(light)![1]),
        );
        assert.deepEqual(
            SURFACES.dark,
            [bg, surface, note].map((name) => new RegExp(`${name}: (#[0-9a-f]{6})`).exec(dark)![1]),
        );
    });
});

describe('styleOf', () => {
    test('gives the style sheet itself without an accent or with one that is not #rrggbb', () => {
        assert.equal(styleOf(null), STYLE);
        for (const bad of [
            '',
            'red',
            '#fff',
            '#12345',
            '#1234567',
            '#12345g',
            'red; } body { display: none',
            '#ff0000;',
        ]) {
            assert.equal(styleOf(bad), STYLE, bad);
        }
    });

    test('keeps a color that is readable as it is, in lower case, and fits the links and the ring otherwise', () => {
        const blue = tokens(styleOf('#1D4ED8'), 'light');
        assert.deepEqual(blue, { accent: '#1d4ed8', text: '#1d4ed8', ring: '#1d4ed8', ink: '#ffffff' });

        const yellow = tokens(styleOf('#ffe600'), 'light');
        assert.equal(yellow.accent, '#ffe600');
        assert.notEqual(yellow.text, '#ffe600');
        assert.equal(yellow.ink, '#17120f');

        const navy = tokens(styleOf('#1a1a40'), 'dark');
        assert.equal(navy.accent, '#1a1a40');
        assert.notEqual(navy.text, '#1a1a40');
        assert.equal(navy.ring, navy.text);
    });

    test('puts the same accent in both schemes, after the style sheet, so that it wins by order', () => {
        const css = styleOf('#2563eb');

        assert.ok(css.startsWith(STYLE));
        assert.equal(tokens(css, 'light').accent, tokens(css, 'dark').accent);
        assert.equal(tokens(css, 'light').ink, tokens(css, 'dark').ink);
        assert.match(
            css.slice(STYLE.length),
            /^:root \{[^}]*\}\n@media \(prefers-color-scheme: dark\) \{ :root \{[^}]*\} \}\n$/,
        );
    });

    test('guarantees 4.5:1 for the links on every surface and for the label of a button, whatever the accent', () => {
        const next = mulberry32(440);
        const accents = [
            '#000000',
            '#ffffff',
            '#ff0000',
            '#00ff00',
            '#0000ff',
            '#ffff00',
            '#808080',
            '#767676',
            '#ff4a1c',
        ];
        for (let n = 0; n < 600; n++) {
            accents.push(
                `#${Math.floor(next() * 0x1000000)
                    .toString(16)
                    .padStart(6, '0')}`,
            );
        }

        for (const accent of accents) {
            const css = styleOf(accent);
            const light = tokens(css, 'light');
            const dark = tokens(css, 'dark');

            assert.ok(lowest(light.text, SURFACES.light) >= 4.5, `light ${accent} -> ${light.text}`);
            assert.ok(lowest(dark.text, SURFACES.dark) >= 4.5, `dark ${accent} -> ${dark.text}`);
            assert.ok(contrast(light.ink, accent) >= 4.5, `ink ${accent} -> ${light.ink}`);
            assert.equal(light.ring, light.text);
            assert.equal(dark.ring, dark.text);
            if (lowest(accent, SURFACES.light) >= 4.5) assert.equal(light.text, accent, `unchanged ${accent}`);
            assert.doesNotMatch(css.slice(STYLE.length), /[^#:{};\n@()\s0-9a-z-]/, accent);
        }
    });
});

describe('uiOf', () => {
    test('turns the pages off for false and for nothing, and on with no personalization for true', () => {
        assert.equal(uiOf(undefined), null);
        assert.equal(uiOf(false), null);
        assert.deepEqual(uiOf(true), { accent: null, logo: null, favicon: null, docs: false });
        assert.deepEqual(uiOf({}), { accent: null, logo: null, favicon: null, docs: false });
    });

    test('turns the docs on only for the value true', () => {
        assert.equal(uiOf({ docs: true })?.docs, true);
        assert.equal(uiOf({ docs: false })?.docs, false);
        for (const value of ['true', 1, {}, null]) {
            assert.equal(uiOf({ docs: value as never })?.docs, false, String(value));
        }
    });

    test('keeps a good accent in lower case, a path or an https address, and drops the rest to null', () => {
        assert.deepEqual(uiOf({ accent: '#FF4A1C', logo: '/logo.svg', favicon: 'https://cdn.example.com/f.ico' }), {
            accent: '#ff4a1c',
            logo: '/logo.svg',
            favicon: 'https://cdn.example.com/f.ico',
            docs: false,
        });

        const bad = [
            '',
            '//evil.example/x.png',
            '/\\evil.example',
            'logo.svg',
            'http://cdn.example.com/a.png',
            'data:image/png;base64,AAAA',
            'javascript:alert(1)',
            'https://user:pass@cdn.example.com/a.png',
            'https://',
            '/a b.svg',
            '/a"onerror="x',
            "/a'b",
            '/a<b',
            '/a\u0001b',
            `/${'a'.repeat(2048)}`,
        ];
        for (const value of bad) {
            assert.deepEqual(
                uiOf({ logo: value, favicon: value, accent: value }),
                {
                    accent: null,
                    logo: null,
                    favicon: null,
                    docs: false,
                },
                value,
            );
        }
        assert.deepEqual(uiOf({ accent: null, logo: null, favicon: null, docs: false }), {
            accent: null,
            logo: null,
            favicon: null,
            docs: false,
        });
    });
});
