import type { ChallengeStorage } from '../../types/storage.js';
import type { ChallengeVerification } from '../../utils/challenge.js';
import type { CaptchaOptions } from '../v4/captcha.js';
export interface CaptchaChallenge {
    contentType: string;
    body: Buffer;
    token: string;
}
/**
 * Generates a hardened captcha whose answer is bound to a signed token instead
 * of being returned in clear. The answer lives only inside the HMAC, so the
 * caller holds a token it cannot read the solution from.
 *
 * @param options - Captcha configuration options
 * @returns PNG buffer, content type, and the token to verify the answer against
 * @throws Error if any option is out of the accepted range
 */
export default function captchaChallenge(options: CaptchaOptions): CaptchaChallenge;
/**
 * Verifies a captcha answer against its token, then consumes the token.
 *
 * @param token - Token issued alongside the challenge image
 * @param answer - Answer read by the user, compared case-insensitively
 * @param storage - Store of already consumed nonces
 * @returns Verification result, with a reason when it fails
 */
export declare function verifyCaptcha(token: string, answer: string, storage: ChallengeStorage): ChallengeVerification;
