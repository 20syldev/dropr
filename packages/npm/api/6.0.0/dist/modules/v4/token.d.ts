/**
 * Generates a cryptographically random token of the specified length and type.
 *
 * @param len - Token length (must be between 12 and 4096)
 * @param type - Character set to use: "alpha", "alphanum", "base64", "hex", "num", "punct", "urlsafe", or "uuid"
 * @returns The generated token string
 * @throws Error if length is out of range or the type is not valid
 */
export default function token(len: number, type?: string): string;
