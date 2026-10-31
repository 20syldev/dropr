import fs from 'fs';
import { join } from 'path';

import type { Response } from 'express';

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

/**
 * Reads the .deprecated.json notice of a project, if any.
 * Like .versions.json, it sits next to the version directories, so listings, archives and checksums never show it.
 *
 * @param projectPath - Project directory, the parent of its version directories
 * @returns The notice, or undefined when the file is missing, unreadable or refused by parseDeprecation
 */
export function getDeprecation(projectPath: string): Deprecation | undefined {
    const file = join(projectPath, '.deprecated.json');
    if (!fs.existsSync(file)) return undefined;

    try {
        const notice = parseDeprecation(JSON.parse(fs.readFileSync(file, 'utf-8')));
        if (notice) return notice;

        console.error(`Invalid deprecation notice in ${file}: expected a date, a message and a successor.`);
    } catch (error) {
        console.error(`Error reading ${file}:`, error);
    }

    return undefined;
}

/**
 * Flags a response as deprecated with the Deprecation (RFC 9745) and Link headers.
 *
 * @param res - Response to flag, before any of its headers are sent
 * @param deprecation - Notice turned into headers by deprecationHeaders
 */
export function setDeprecationHeaders(res: Response, deprecation: Deprecation): void {
    for (const [name, value] of Object.entries(deprecationHeaders(deprecation))) res.setHeader(name, value);
}
