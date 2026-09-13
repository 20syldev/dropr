export interface PasswordResult {
    passwords: string[];
    type: string;
    length: number;
    strength: string;
    entropy: number;
}
/**
 * Generates one or more passwords using random characters or passphrase mode.
 *
 * @param type - Generation mode: "random" or "passphrase"
 * @param length - Password length for random mode (8–128), or word count for passphrase mode (3–10)
 * @param options - Character set options: uppercase, lowercase, digits, symbols, exclude, count, separator
 * @returns Generated passwords with type, length, strength and entropy
 * @throws Error if no charset is active, length is out of range, or count exceeds the maximum
 */
export default function password(type?: string, length?: number, options?: {
    uppercase?: boolean;
    lowercase?: boolean;
    digits?: boolean;
    symbols?: boolean;
    exclude?: string;
    count?: number;
    separator?: string;
}): PasswordResult;
