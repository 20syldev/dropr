import fs from 'fs';
import { join } from 'path';

import type { Response } from 'express';

import type { Deprecation } from '../types/index.js';

/**
 * Reads the .deprecated.json notice of a project, if any.
 * Like .versions.json, it sits next to the version directories, so listings, archives and checksums never show it.
 * A notice missing a parsable date, a message or a successor is ignored, since it would produce invalid headers.
 *
 * @param projectPath - Project directory, the parent of its version directories
 * @returns The notice, or undefined when the file is missing, unreadable or incomplete
 */
export function getDeprecation(projectPath: string): Deprecation | undefined {
    const file = join(projectPath, '.deprecated.json');
    if (!fs.existsSync(file)) return undefined;

    try {
        const notice = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<Deprecation> | null;
        const { date, message, successor } = notice ?? {};

        if (typeof date === 'string' && typeof message === 'string' && typeof successor === 'string') {
            if (Number.isFinite(Date.parse(date))) return { date, message, successor };
        }
        console.error(`Invalid deprecation notice in ${file}: expected a date, a message and a successor.`);
    } catch (error) {
        console.error(`Error reading ${file}:`, error);
    }

    return undefined;
}

/**
 * Flags a response as deprecated with the Deprecation (RFC 9745) and Link headers.
 * Clients can then detect the notice and follow the successor project.
 *
 * @param res - Response to flag, before any of its headers are sent
 * @param deprecation - Notice whose date becomes a Unix timestamp in seconds and whose successor is the Link target
 */
export function setDeprecationHeaders(res: Response, deprecation: Deprecation): void {
    res.setHeader('Deprecation', `@${Math.floor(Date.parse(deprecation.date) / 1000)}`);
    res.setHeader('Link', `<${deprecation.successor}>; rel="successor-version"`);
}
