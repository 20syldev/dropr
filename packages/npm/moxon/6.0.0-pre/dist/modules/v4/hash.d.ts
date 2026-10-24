export interface HashResult {
    method: string;
    hash: string;
    encoding: string;
}
/**
 * Hashes a text string using the specified algorithm and encoding.
 *
 * @param text - The text to hash
 * @param method - Hashing algorithm (e.g. "sha256", "md5")
 * @param encoding - Output encoding: "hex" (default) or "base64"
 * @returns Object containing the method, hash result, and encoding used
 * @throws Error if text is missing, the method is unsupported, or the encoding is invalid
 */
export default function hash(text: string, method: string, encoding?: string): HashResult;
