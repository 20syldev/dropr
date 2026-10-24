import type { ChallengeStorage } from '../../types/storage.js';
import type { ChallengeVerification } from '../../utils/challenge.js';
export interface PowChallenge {
    algorithm: 'sha256';
    salt: string;
    difficulty: number;
    expires: number;
    token: string;
    instructions: string;
}
/**
 * Issues a proof-of-work challenge: the client must find a nonce whose hash
 * starts with the requested number of hexadecimal zeros. Difficulty 4 averages
 * about 32k hashes, unnoticeable for a person but costly to repeat at scale.
 *
 * @param difficulty - Leading hexadecimal zeros required (1-6, default 4)
 * @returns Challenge with its salt, difficulty, expiry and signed token
 * @throws Error if the difficulty is not a number or out of range
 */
export default function pow(difficulty?: number): PowChallenge;
/**
 * Verifies a solved proof-of-work challenge, then consumes the token.
 *
 * @param token - Token issued by the challenge
 * @param nonce - Nonce found by the client
 * @param storage - Store of already consumed nonces
 * @returns Verification result, with a reason when it fails
 */
export declare function verifyPow(token: string, nonce: string, storage: ChallengeStorage): ChallengeVerification;
