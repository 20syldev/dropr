export interface TextStats {
    characters: number;
    charactersNoSpaces: number;
    words: number;
    sentences: number;
    paragraphs: number;
    readingTime: string;
    mostFrequentChar: string;
}
/**
 * Analyzes a text string and returns character, word, sentence, and reading time statistics.
 *
 * @param value - The text to analyze
 * @returns Object containing character counts, word/sentence/paragraph counts, reading time, and most frequent character
 * @throws Error if value is missing, not a string, or too long
 */
export declare function stats(value: string): TextStats;
/**
 * Converts a string to a URL-friendly slug.
 *
 * @param value - The string to slugify
 * @returns Lowercase hyphenated slug with diacritics and special characters removed
 * @throws Error if value is missing, not a string, or too long
 */
export declare function slug(value: string): string;
/**
 * Generates Lorem Ipsum placeholder text.
 *
 * @param type - Content type: "words", "sentences", or "paragraphs"
 * @param count - Number of words, sentences, or paragraphs to generate
 * @returns Generated Lorem Ipsum text
 * @throws Error if count is out of range or type is not one of the accepted values
 */
export declare function lorem(type: string, count: string): string;
/**
 * Converts an integer to its written-out word form in French or English.
 *
 * @param value - The integer to convert (must be less than 1 billion)
 * @param lang - Language: "fr" for French or "en" for English
 * @returns The number written out in words
 * @throws Error if value is not an integer, exceeds the maximum, or lang is not supported
 */
export declare function number(value: string, lang: string): string;
