export interface OtpSecretResult {
    secret: string;
    uri: string;
}
export interface OtpGenerateResult {
    code: string;
    remaining: number;
    period: number;
}
export interface OtpVerifyResult {
    valid: boolean;
    drift: number;
}
/**
 * Generates or verifies TOTP/HOTP codes (RFC 4226 / RFC 6238).
 *
 * @param action - "secret", "generate", or "verify"
 * @param options - Configuration options
 * @returns Result depending on action
 */
export default function otp(action: string, options?: {
    secret?: string;
    code?: string;
    algorithm?: string;
    digits?: number;
    period?: number;
    counter?: number;
    label?: string;
    issuer?: string;
}): OtpSecretResult | OtpGenerateResult | OtpVerifyResult;
