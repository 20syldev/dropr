export interface JwtResult {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    signature: string;
    expired?: boolean;
}
/**
 * Decodes a JSON Web Token (header + payload) without verifying the signature.
 * WARNING: The signature is NOT verified. Use this for inspection only, not for security decisions.
 */
export default function jwt(token: string): JwtResult;
