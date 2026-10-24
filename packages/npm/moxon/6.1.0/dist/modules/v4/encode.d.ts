/**
 * Encodes a UTF-8 string to Base64.
 *
 * @param value - The string to encode
 * @returns Base64-encoded string
 * @throws Error if value is missing, not a string, or too long
 */
export declare function base64encode(value: string): string;
/**
 * Decodes a Base64 string to UTF-8.
 *
 * @param value - The Base64 string to decode
 * @returns Decoded UTF-8 string
 * @throws Error if value is missing, not valid Base64, or too long
 */
export declare function base64decode(value: string): string;
/**
 * Percent-encodes a string for safe use in a URL.
 *
 * @param value - The string to encode
 * @returns URL-encoded string
 * @throws Error if value is missing, not a string, or too long
 */
export declare function urlencode(value: string): string;
/**
 * Decodes a percent-encoded URL string.
 *
 * @param value - The URL-encoded string to decode
 * @returns Decoded string
 * @throws Error if value is missing, not a valid URL-encoded string, or too long
 */
export declare function urldecode(value: string): string;
/**
 * Converts a plain text string to Morse code.
 *
 * @param value - The text to encode in Morse code
 * @returns Morse code string where letters are separated by spaces and words by " / "
 * @throws Error if value contains unsupported characters or is too long
 */
export declare function morse(value: string): string;
/**
 * Converts a Morse code string back to plain text.
 *
 * @param value - Morse code string (letters separated by spaces, words by " / ")
 * @returns Decoded plain text string
 * @throws Error if the Morse code contains an unrecognized sequence or is too long
 */
export declare function unmorse(value: string): string;
/**
 * Applies the ROT13 substitution cipher to a string.
 *
 * @param value - The string to encode
 * @returns ROT13-encoded string (applying it twice restores the original)
 * @throws Error if value is missing, not a string, or too long
 */
export declare function rot13(value: string): string;
/**
 * Applies the Caesar cipher by shifting alphabetic characters by a given amount.
 *
 * @param value - The string to encode
 * @param shift - Number of positions to shift (can be negative for left shift)
 * @returns Caesar-shifted string
 * @throws Error if value is missing or shift is not a number
 */
export declare function caesar(value: string, shift: string): string;
/**
 * Converts a string to its binary representation, one byte per character.
 *
 * @param value - The string to convert
 * @returns Space-separated 8-bit binary groups (one per character)
 * @throws Error if value is missing, not a string, or too long
 */
export declare function binary(value: string): string;
/**
 * Converts a binary string back to plain text.
 *
 * @param value - Space-separated 8-bit binary groups
 * @returns Decoded string
 * @throws Error if value contains non-binary characters or groups are not 8 bits wide
 */
export declare function unbinary(value: string): string;
