import fs from 'fs';
import { join } from 'path';
import type { Response } from 'express';
import type { Deprecation } from '../types/index.js';

/**
 * Reads the .deprecated.json notice of a project, if any.
 * Like .versions.json, the notice sits next to the version directories, so it
 * never shows up in listings, archives or checksums.
 *
 * A notice missing a parsable date, a message or a successor is ignored, since it
 * would produce invalid headers.
 *
 * @param projectPath - Directory of the project
 * @returns The deprecation notice, or undefined if the project is not deprecated
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
 * Flags a response as deprecated with the Deprecation (RFC 9745) and Link headers,
 * so clients can detect the notice and follow the successor project.
 *
 * @param res - Express response object
 * @param deprecation - Deprecation notice of the project
 */
export function setDeprecationHeaders(res: Response, deprecation: Deprecation): void {
    res.setHeader('Deprecation', `@${Math.floor(Date.parse(deprecation.date) / 1000)}`);
    res.setHeader('Link', `<${deprecation.successor}>; rel="successor-version"`);
}
