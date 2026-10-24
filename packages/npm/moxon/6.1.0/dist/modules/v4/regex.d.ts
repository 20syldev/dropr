export interface RegexMatch {
    match: string;
    index: number;
    groups: string[];
    namedGroups: Record<string, string>;
}
export interface RegexResult {
    valid: boolean;
    pattern: string;
    flags: string;
    matches: RegexMatch[];
    count: number;
}
/**
 * Tests a regular expression pattern against a text and returns structured match results.
 *
 * @param pattern - The regex pattern to test (max 200 characters)
 * @param text - The text to match against (max 1000 characters)
 * @param flags - Optional regex flags; only g, i, m, s, u are accepted (g is always forced)
 * @returns Match results with groups and named groups, or { valid: false } if the pattern is invalid
 * @throws Error if pattern or text is missing or exceeds the maximum length
 */
export default function regex(pattern: string, text: string, flags?: string): RegexResult;
