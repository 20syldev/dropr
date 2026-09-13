export interface UrlResult {
    url: string;
    scheme: string;
    host: string;
    port: number | null;
    path: string;
    params: Record<string, string | string[]>;
    fragment: string;
    valid: boolean;
}
/**
 * Parses a URL into its structural components.
 *
 * @param url - Absolute URL to parse, including its scheme (e.g. https://example.com/path?a=1)
 * @returns Object with the original URL, scheme, host, port, path, query parameters, fragment, and validity status
 * @throws Error if the URL is empty, exceeds the maximum length, or cannot be parsed
 */
export default function parseUrl(url: string): UrlResult;
