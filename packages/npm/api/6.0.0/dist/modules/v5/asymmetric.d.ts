export interface KeygenResult {
    action: string;
    algorithm: string;
    modulusLength: number;
    publicKey: string;
    privateKey: string;
}
export interface AsymmetricCryptResult {
    action: string;
    algorithm: string;
    result: string;
}
/**
 * RSA asymmetric key generation, encryption and decryption.
 *
 * @param action - "keygen", "encrypt", or "decrypt"
 * @param options - Options object with text, publicKey, privateKey, modulusLength, algorithm
 * @returns Keygen or crypt result object
 */
export default function asymmetric(action: string, options?: {
    text?: string;
    publicKey?: string;
    privateKey?: string;
    modulusLength?: number;
    algorithm?: string;
}): KeygenResult | AsymmetricCryptResult;
