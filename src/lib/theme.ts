import type { UiInput, UiSettings } from '../types/index.js';

import { STYLE } from './style.js';

/**
 * Backgrounds that text of the pages can sit on, for each color scheme: the page, a card and a notice.
 * They are the ones of the style sheet, and a test fails when the two drift apart.
 */
export const SURFACES: Record<'light' | 'dark', string[]> = {
    light: ['#fbf8f5', '#ffffff', '#fdf0d5'],
    dark: ['#120e0c', '#1c1714', '#3a2a0c'],
};

/** Smallest contrast ratio WCAG asks of normal text. */
const READABLE = 4.5;

/** Ink of a button on a light accent, the same as the text of the pages. */
const DARK_INK = '#17120f';

/** Longest address kept for a logo or a favicon. */
const MAX_ADDRESS = 2048;

const COLOR = /^#[0-9a-fA-F]{6}$/;

const PATH = /^\/(?![/\\])[^\s"'<>\\\p{Cc}]*$/u;

const SECURE = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?#][^\s"'<>\\\p{Cc}]*)?$/u;

/**
 * Reads the channels of a color.
 *
 * @param color - Color written #rrggbb
 * @returns Red, green and blue from 0 to 255
 */
function channels(color: string): [number, number, number] {
    return [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16)) as [number, number, number];
}

/**
 * Gives the relative luminance of a color as WCAG defines it.
 *
 * @param color - Color written #rrggbb
 * @returns A number from 0 for black to 1 for white
 */
function luminance(color: string): number {
    const [red, green, blue] = channels(color).map((value) => {
        const unit = value / 255;

        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * Gives the contrast ratio of two colors as WCAG defines it.
 *
 * @param first - Color written #rrggbb
 * @param second - Color written #rrggbb
 * @returns A ratio from 1 for the same color to 21 for black on white
 */
export function contrast(first: string, second: string): number {
    const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);

    return Math.round(((light + 0.05) / (dark + 0.05)) * 1e9) / 1e9;
}

/**
 * Moves a color toward another.
 *
 * @param color - Color written #rrggbb
 * @param target - Color written #rrggbb that a share of 1 reaches
 * @param share - How far to go, from 0 to 1
 * @returns The mixed color written #rrggbb
 */
function mix(color: string, target: string, share: number): string {
    const goal = channels(target);

    return `#${channels(color)
        .map((value, index) =>
            Math.round(value + (goal[index] - value) * share)
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')}`;
}

/**
 * Gives the color closest to an accent that stays readable as text on every surface of a scheme.
 *
 * @param accent - Accent written #rrggbb
 * @param scheme - Color scheme the text is read in
 * @returns The accent itself when it is readable, else the accent moved toward black on light and toward white on dark
 */
function fit(accent: string, scheme: 'light' | 'dark'): string {
    const target = scheme === 'light' ? '#000000' : '#ffffff';
    for (let step = 0; step <= 100; step++) {
        const color = mix(accent, target, step / 100);
        if (SURFACES[scheme].every((surface) => contrast(color, surface) >= READABLE)) return color;
    }

    return target;
}

/**
 * Chooses the color of a label that sits on the accent.
 *
 * @param accent - Accent written #rrggbb
 * @returns White or the ink of the pages, whichever reads better, and black or white when neither reaches 4.5
 */
function inkOn(accent: string): string {
    const better = (first: string, second: string): string =>
        contrast(first, accent) >= contrast(second, accent) ? first : second;
    const ink = better('#ffffff', DARK_INK);

    return contrast(ink, accent) >= READABLE ? ink : better('#ffffff', '#000000');
}

/**
 * Writes the variables of one scheme.
 *
 * @param accent - Accent written #rrggbb
 * @param scheme - Color scheme the variables are for
 * @returns The declarations, without braces
 */
function variables(accent: string, scheme: 'light' | 'dark'): string {
    const text = fit(accent, scheme);

    return `--accent: ${accent}; --accent-text: ${text}; --ring: ${text}; --accent-ink: ${inkOn(accent)};`;
}

/**
 * Builds the style sheet of the pages for an accent.
 *
 * @param accent - Accent written #rrggbb, in any case, or null to keep the look of the pages
 * @returns The style sheet itself without a valid accent, else the sheet followed by the variables of the accent
 */
export function styleOf(accent: string | null): string {
    if (accent === null || !COLOR.test(accent)) return STYLE;
    const color = accent.toLowerCase();

    return `${STYLE}:root { ${variables(color, 'light')} }\n@media (prefers-color-scheme: dark) { :root { ${variables(color, 'dark')} } }\n`;
}

/**
 * Tells whether an address can go in an image or a link tag of a page without leaving the site by accident.
 *
 * @param value - Address given by the owner
 * @returns True for a path of this site or an https address, within the length limit
 */
export function isAddress(value: unknown): value is string {
    return typeof value === 'string' && value.length <= MAX_ADDRESS && (PATH.test(value) || SECURE.test(value));
}

/**
 * Keeps an address that a page can use.
 *
 * @param value - Address given by the owner
 * @returns The address when isAddress accepts it, else null
 */
function addressOf(value: string | null | undefined): string | null {
    return isAddress(value) ? value : null;
}

/**
 * Reads the option that turns the pages on.
 *
 * @param input - The ui option of the responder or of the config
 * @returns Null when the pages are off, else what to personalize, with a value that cannot be used left null
 */
export function uiOf(input: UiInput | undefined): UiSettings | null {
    if (!input) return null;
    const own = input === true ? {} : input;
    const accent = typeof own.accent === 'string' && COLOR.test(own.accent) ? own.accent.toLowerCase() : null;

    return { accent, logo: addressOf(own.logo), favicon: addressOf(own.favicon), docs: own.docs === true };
}
