export interface IpResult {
    ip: string;
    version: 'IPv4' | 'IPv6';
    type: 'public' | 'private' | 'loopback' | 'link-local' | 'multicast' | 'broadcast';
    class?: 'A' | 'B' | 'C' | 'D' | 'E';
    range?: string;
    binary: string;
    decimal?: number;
    reverse: string;
}
/**
 * Analyzes an IPv4 or IPv6 address and returns its type, class, binary
 * representation, decimal value, and reverse DNS notation.
 *
 * @param address - The IP address to analyze
 * @returns Detailed breakdown of the address
 * @throws Error if the address is missing or invalid
 */
export default function ip(address: string): IpResult;
