import type { ChallengeStorage } from '../types/storage.js';
export interface ChallengeVerification {
    valid: boolean;
    reason?: 'wrong' | 'expired' | 'used' | 'invalid';
}
export interface TokenPayload {
    type: 'img' | 'pow';
    nonce: string;
    exp: number;
    salt?: string;
    difficulty?: number;
    sig: string;
}
/**
 * Signs a challenge into a stateless token. The expected answer never appears in
 * the token itself, only in the HMAC, so it cannot be read back by the client.
 *
 * @param type - Challenge kind: img for a captcha, pow for a proof-of-work
 * @param payload - Secret material bound to the token: the answer, or the salt and difficulty
 * @param extra - Public fields to carry along, such as salt and difficulty
 * @returns Base64url token carrying the nonce, expiry and signature
 */
export declare function signToken(type: 'img' | 'pow', payload: string, extra?: Record<string, unknown>): string;
/**
 * Verifies a token against the payload it was signed with, then consumes its
 * nonce so the same token cannot be replayed.
 *
 * @param token - Token issued by signToken
 * @param payload - Payload to check the signature against
 * @param storage - Store of already consumed nonces
 * @returns Verification result, with a reason when it fails
 */
export declare function verifyToken(token: string, payload: string, storage: ChallengeStorage): ChallengeVerification;
/**
 * Reads the public fields of a token without verifying its signature.
 *
 * @param token - Token issued by signToken
 * @returns Decoded payload, or null if the token is malformed
 */
export declare function readToken(token: string): TokenPayload | null;
