/**
 * Computes the Levenshtein edit distance between two strings.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Object containing both strings and the minimum number of single-character edits to transform one into the other
 * @throws Error if either string is missing, not a string, or exceeds the maximum length
 */
export default function levenshtein(str1: string, str2: string): {
    str1: string;
    str2: string;
    distance: number;
};
