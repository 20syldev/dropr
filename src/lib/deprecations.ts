import type { Deprecation } from '../types/index.js';

import { parseDay } from './dates.js';

// A URL reference as an HTTP header can carry it inside <>: printable ASCII, no space, '<', '>' or '"'
const REFERENCE = /^[\x21\x23-\x3b\x3d\x3f-\x7e]+$/;

/**
 * Checks a parsed .deprecated.json value and keeps its notice fields.
 * A notice missing a date, a message or a successor is refused, since it would produce invalid headers. So is a date
 * that is not a real YYYY-MM-DD day, which Date.parse would read in the time zone of the server for some spellings, and
 * a successor that is empty or holds anything a URL reference between <> cannot (a control character, a space, a
 * character past ASCII, '<', '>' or '"'), which would otherwise fail every request of its project.
 *
 * @param value - Parsed JSON of any shape, null and primitives included
 * @returns A new notice with only the date, message and successor strings, or null when one is missing, the date is not
 * a real day or the successor is refused
 */
export function parseDeprecation(value: unknown): Deprecation | null {
    const { date, message, successor } = (value ?? {}) as Partial<Deprecation>;
    if (typeof date !== 'string' || typeof message !== 'string' || typeof successor !== 'string') return null;

    if (parseDay(date) === null || !REFERENCE.test(successor)) return null;

    return { date, message, successor };
}

/**
 * Builds the Deprecation (RFC 9745) and Link headers that flag a deprecated project.
 * Clients can then detect the notice and follow the successor project.
 *
 * @param notice - Notice that parseDeprecation accepted, whose day becomes a Unix timestamp in seconds, at 00:00:00 UTC,
 * and whose successor is the Link target
 * @returns Deprecation then Link, the order they are set in
 */
export function deprecationHeaders(notice: Deprecation): Record<string, string> {
    return {
        Deprecation: `@${Math.floor(Date.parse(notice.date) / 1000)}`,
        Link: `<${notice.successor}>; rel="successor-version"`,
    };
}
