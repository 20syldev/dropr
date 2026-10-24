export interface EncryptResult {
    action: string;
    algorithm: string;
    result: string;
}
/**
 * Encrypts or decrypts text using AES with key derivation via scrypt.
 *
 * @param action - "encrypt" or "decrypt"
 * @param text - Text to encrypt, or base64 blob to decrypt
 * @param key - User-provided key (min 8 characters)
 * @param algorithm - Cipher algorithm (default: aes-256-gcm)
 * @returns Object containing action, algorithm, and base64 result
 */
export default function encrypt(action: string, text: string, key: string, algorithm?: string): EncryptResult;
