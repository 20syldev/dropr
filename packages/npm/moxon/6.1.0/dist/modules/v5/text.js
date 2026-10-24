import * as v4text from '../v4/text.js';
export * from '../v4/text.js';
/**
 * Converts a number to its written form in the given language.
 */
export function number(value, lang) {
    const result = v4text.number(value, lang);
    if (lang === 'fr')
        return result.replace(/soixante-onze/g, 'soixante et onze');
    return result;
}
//# sourceMappingURL=text.js.map