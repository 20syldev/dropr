#!/usr/bin/env node
import fs from 'fs';

/**
 * Maintains the .versions.json metadata file of a project.
 * Entries live next to the version directories, never inside them, so they
 * stay out of file listings, archives and checksums.
 *
 * Usage: node scripts/versions.mjs <file> <version> <date> [repo]
 */

const [file, version, date, repo] = process.argv.slice(2);
if (!file || !version || !date) {
    console.error('Usage: node scripts/versions.mjs <file> <version> <date> [repo]');
    process.exit(1);
}

function compareVersions(a, b) {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const diff = (aParts[i] || 0) - (bParts[i] || 0);
        if (diff !== 0) return diff;
    }

    return 0;
}

const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
data[version] = repo ? { date, repo } : { date };

const sorted = Object.fromEntries(Object.keys(data).sort(compareVersions).map((key) => [key, data[key]]));

fs.writeFileSync(file, JSON.stringify(sorted, null, 4) + '\n');
