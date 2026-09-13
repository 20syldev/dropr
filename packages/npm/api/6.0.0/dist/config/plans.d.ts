/**
 * Rate limit plans configuration.
 *
 * hourly  — max requests per hour (matches pricing page)
 * burst   — max requests per 10-second window
 * tokens  — list of bearer tokens for this tier
 *
 * To adjust limits, edit the values below or override via .env:
 *   DEFAULT_LIMIT, ADVANCED_LIMIT, PRO_LIMIT, BUSINESS_LIMIT
 *   DEFAULT_BURST, ADVANCED_BURST, PRO_BURST, BUSINESS_BURST
 */
export interface Plan {
    hourly: number;
    burst: number;
    tokens: string[];
}
export declare const plans: Record<string, Plan>;
export declare const globalLimit: number;
/**
 * Returns the plan matching a bearer token, or 'default'.
 * Returns null if the token is provided but invalid.
 */
export declare function getPlan(token: string): {
    name: string;
    plan: Plan;
} | null;
