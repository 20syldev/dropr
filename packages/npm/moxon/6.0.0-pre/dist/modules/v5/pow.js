import { createHash, randomBytes } from 'node:crypto';
import { MAX_POW_DIFFICULTY, POW_DEFAULT_DIFFICULTY } from '../../constants.js';
import { readToken, signToken, verifyToken } from '../../utils/challenge.js';
const digest = (salt, nonce) => createHash('sha256').update(`${salt}${nonce}`).digest('hex');
/**
 * Issues a proof-of-work challenge: the client must find a nonce whose hash
 * starts with the requested number of hexadecimal zeros. Difficulty 4 averages
 * about 32k hashes, unnoticeable for a person but costly to repeat at scale.
 *
 * @param difficulty - Leading hexadecimal zeros required (1-6, default 4)
 * @returns Challenge with its salt, difficulty, expiry and signed token
 * @throws Error if the difficulty is not a number or out of range
 */
export default function pow(difficulty = POW_DEFAULT_DIFFICULTY) {
    if (isNaN(difficulty))
        throw new Error('Difficulty must be a number');
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > MAX_POW_DIFFICULTY) {
        throw new Error(`Difficulty must be between 1 and ${MAX_POW_DIFFICULTY}`);
    }
    const salt = randomBytes(8).toString('hex');
    const token = signToken('pow', `${salt}.${difficulty}`, { salt, difficulty });
    return {
        algorithm: 'sha256',
        salt,
        difficulty,
        expires: readToken(token).exp,
        token,
        instructions: `Find nonce so that sha256(salt + nonce) starts with ${difficulty} hex zeros`,
    };
}
/**
 * Verifies a solved proof-of-work challenge, then consumes the token.
 *
 * @param token - Token issued by the challenge
 * @param nonce - Nonce found by the client
 * @param storage - Store of already consumed nonces
 * @returns Verification result, with a reason when it fails
 */
export function verifyPow(token, nonce, storage) {
    const decoded = readToken(token);
    if (!decoded || decoded.type !== 'pow' || !decoded.salt || !decoded.difficulty) {
        return { valid: false, reason: 'invalid' };
    }
    if (!digest(decoded.salt, nonce).startsWith('0'.repeat(decoded.difficulty))) {
        return { valid: false, reason: 'wrong' };
    }
    return verifyToken(token, `${decoded.salt}.${decoded.difficulty}`, storage);
}
//# sourceMappingURL=pow.js.map