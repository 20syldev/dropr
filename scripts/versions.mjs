#!/usr/bin/env node
import fs from 'fs';

/**
 * Splits a version string into its numeric core and its pre-release tag.
 *
 * @param version - Dotted version, the pre-release tag being everything after the first dash (e.g. "6.0.0-pre")
 * @returns Numeric core segments and pre-release tag, null for a release
 */
function parseVersion(version) {
    const dash = version.indexOf('-');
    if (dash === -1) return { core: version.split('.').map(Number), pre: null };

    return { core: version.slice(0, dash).split('.').map(Number), pre: version.slice(dash + 1) };
}

/**
 * Compares two versions numerically, the same way as the server orders them.
 * A pre-release sorts before its release (e.g. 6.0.0-pre before 6.0.0).
 *
 * @param a - Left-hand version, its missing or non-numeric segments counting as 0
 * @param b - Right-hand version, parsed the same way as a
 * @returns Negative if a sorts first, positive if b sorts first, zero if equal
 */
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

/**
 * Records the release date of a version in the .versions.json of its project, the entries kept sorted by version.
 * The file sits next to the version directories, so it stays out of file listings, archives and checksums.
 *
 * @param argv - Command line arguments as passed by fetch.sh: <file> <version> <date> [repo], the date as YYYY-MM-DD
 * and the optional repo as user/name; exits with status 1 when one of the first three is missing
 */
function main(argv) {
    const [file, version, date, repo] = argv;
    if (!file || !version || !date) {
        console.error('Usage: node scripts/versions.mjs <file> <version> <date> [repo]');
        process.exit(1);
    }

    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
    data[version] = repo ? { date, repo } : { date };

    const sorted = Object.fromEntries(
        Object.keys(data)
            .sort(compareVersions)
            .map((key) => [key, data[key]]),
    );

    fs.writeFileSync(file, JSON.stringify(sorted, null, 4) + '\n');
}

main(process.argv.slice(2));
