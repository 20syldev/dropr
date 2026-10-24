export interface UserAgentResult {
    raw: string;
    browser: {
        name: string;
        version: string;
        major: string;
    };
    os: {
        name: string;
        version: string;
    };
    device: {
        type: 'mobile' | 'tablet' | 'desktop';
        vendor: string;
    };
    engine: {
        name: string;
        version: string;
    };
    bot: boolean;
}
/**
 * Parses a User-Agent string and extracts browser, OS, device, engine
 * and bot information.
 *
 * @param ua - The User-Agent string to parse
 * @returns Structured breakdown of the User-Agent
 * @throws Error if the User-Agent string is missing or too long
 */
export default function agent(ua: string): UserAgentResult;
