import { createHash, getHashes } from 'crypto';
const ENCODINGS = new Set(['hex', 'base64']);
/**
 * Hashes a text string using the specified algorithm and encoding.
 *
 * @param text - The text to hash
 * @param method - Hashing algorithm (e.g. "sha256", "md5")
 * @param encoding - Output encoding: "hex" (default) or "base64"
 * @returns Object containing the method, hash result, and encoding used
 * @throws Error if text is missing, the method is unsupported, or the encoding is invalid
 */
export default function hash(text, method, encoding = 'hex') {
    if (!text)
        throw new Error('Text is required');
    const methods = getHashes();
    if (!methods.includes(method))
        throw new Error(`Unsupported method. Use one of: ${methods.join(', ')}`);
    if (!ENCODINGS.has(encoding))
        throw new Error('Encoding must be one of: hex, base64');
    const result = createHash(method)
        .update(text)
        .digest(encoding);
    return { method, hash: result, encoding };
}
//# sourceMappingURL=hash.js.map