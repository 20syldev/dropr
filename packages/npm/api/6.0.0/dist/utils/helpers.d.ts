/**
 * Tracks requests per user and throws if the rate limit is exceeded.
 *
 * @param rateLimits - Store of timestamps per user
 * @param userId - Identifier of the requesting user
 * @param timestamp - Current timestamp in milliseconds
 * @param window - Time window in milliseconds
 * @param limit - Maximum requests allowed in the window
 * @returns false if within limits
 * @throws Error if rate limit is exceeded
 */
export declare function checkRateLimit(rateLimits: Record<string, number[]>, userId: string, timestamp: number, window?: number, limit?: number): boolean;
/**
 * Parses a space-separated environment variable into an array.
 *
 * @param key - The environment variable name
 * @returns The parsed array, or null if not set
 */
export declare function envList(key: string): string[] | null;
/**
 * Formats a Date to ISO string without timezone suffix.
 *
 * @param date - The date to format
 * @returns ISO-formatted string without trailing Z
 */
export declare function formatDate(date: Date): string;
/**
 * Generates a random IPv4 address.
 *
 * @returns A string in the format "X.X.X.X"
 */
export declare function genIP(): string;
/**
 * Returns a random element from an array.
 *
 * @param arr - The source array
 * @returns A random element
 */
export declare function random<T>(arr: T[]): T;
/**
 * Returns a random integer between min and max (inclusive).
 *
 * @param min - Lower bound
 * @param max - Upper bound
 * @returns A random integer in [min, max]
 */
export declare function randomNumber(min: number, max: number): number;
/**
 * Checks if a version string is at least the given minimum.
 *
 * @param version - Version string (e.g. "v4")
 * @param min - Minimum version number
 * @returns true if the version is >= min
 */
export declare function since(version: string, min: number): boolean;
