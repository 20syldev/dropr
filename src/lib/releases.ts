import fs from 'fs';
import { join } from 'path';

/**
 * Reads the .versions.json metadata of every project into a flat index.
 * These files sit next to the version directories rather than inside them, so
 * their content never shows up in listings, archives or checksums.
 *
 * @param rootDir - Root directory containing package types
 * @returns Map of 'type/project/version' keys to release dates
 */
export function getReleaseDates(rootDir: string): Map<string, string> {
    const dates = new Map<string, string>();

    for (const type of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (!type.isDirectory()) continue;

        for (const project of fs.readdirSync(join(rootDir, type.name), { withFileTypes: true })) {
            if (!project.isDirectory()) continue;

            const file = join(rootDir, type.name, project.name, '.versions.json');
            if (!fs.existsSync(file)) continue;

            try {
                const entries = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, { date?: string }>;
                for (const [version, entry] of Object.entries(entries)) {
                    if (entry.date) dates.set(`${type.name}/${project.name}/${version}`, entry.date);
                }
            } catch (error) {
                console.error(`Error reading ${file}:`, error);
            }
        }
    }

    return dates;
}
