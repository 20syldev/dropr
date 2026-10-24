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

function parseVersion(version) {
    const dash = version.indexOf('-');
    if (dash === -1) return { core: version.split('.').map(Number), pre: null };

    return { core: version.slice(0, dash).split('.').map(Number), pre: version.slice(dash + 1) };
}

// A pre-release sorts before its release (e.g. 6.0.0-pre < 6.0.0)
function compareVersions(a, b) {
    const aVersion = parseVersion(a);
    const bVersion = parseVersion(b);

    for (let i = 0; i < Math.max(aVersion.core.length, bVersion.core.length); i++) {
        const diff = (aVersion.core[i] || 0) - (bVersion.core[i] || 0);
        if (diff !== 0) return diff;
    }

    if (aVersion.pre === bVersion.pre) return 0;
    if (aVersion.pre === null) return 1;
    if (bVersion.pre === null) return -1;

    return aVersion.pre.localeCompare(bVersion.pre, 'en', { numeric: true });
}

const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
data[version] = repo ? { date, repo } : { date };

const sorted = Object.fromEntries(Object.keys(data).sort(compareVersions).map((key) => [key, data[key]]));

fs.writeFileSync(file, JSON.stringify(sorted, null, 4) + '\n');
