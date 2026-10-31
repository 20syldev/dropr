import type { Deprecation } from '../types/index.js';

/**
 * Checks a parsed .deprecated.json value and keeps its notice fields.
 * A notice missing a parsable date, a message or a successor is refused, since it would produce invalid headers.
 *
 * @param value - Parsed JSON of any shape, null and primitives included
 * @returns A new notice with only the date, message and successor strings, or null when one is missing or the date
 * does not parse
 */
export function parseDeprecation(value: unknown): Deprecation | null {
    const { date, message, successor } = (value ?? {}) as Partial<Deprecation>;
    if (typeof date !== 'string' || typeof message !== 'string' || typeof successor !== 'string') return null;

    return Number.isFinite(Date.parse(date)) ? { date, message, successor } : null;
}

/**
 * Builds the Deprecation (RFC 9745) and Link headers that flag a deprecated project.
 * Clients can then detect the notice and follow the successor project.
 *
 * @param notice - Notice whose date becomes a Unix timestamp in seconds and whose successor is the Link target
 * @returns Deprecation then Link, the order they are set in
 */
export function deprecationHeaders(notice: Deprecation): Record<string, string> {
    return {
        Deprecation: `@${Math.floor(Date.parse(notice.date) / 1000)}`,
        Link: `<${notice.successor}>; rel="successor-version"`,
    };
}
