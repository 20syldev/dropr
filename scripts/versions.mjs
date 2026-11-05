#!/usr/bin/env node
import fs from 'fs';
import { dirname } from 'path';
import { pathToFileURL } from 'url';

// Pieces of a version folder name as semver.org writes them: numbers and numeric tag identifiers have no leading zero
const NUMBER = '(?:0|[1-9]\\d*)';
const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';

// The only names of version folders that the server indexes: X.Y.Z or X.Y.Z-tag, without build metadata
const VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?$`);

/**
 * Tells whether a text is a version name that the server indexes.
 *
 * @param text - Candidate version, as it would name a folder
 * @returns True for X.Y.Z or X.Y.Z-tag, false for anything else, a leading v and leading zeros included
 */
export function isVersion(text) {
    return VERSION.test(text);
}

/**
 * Tells whether a text is a release date that the server reads.
 *
 * @param text - Candidate date
 * @returns True for a real YYYY-MM-DD day from 1970 to today (UTC), false for any other spelling, an impossible day
 * or a day to come
 */
export function isDay(text) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return false;

    const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    return new Date(time).toISOString().startsWith(text) && time >= 0 && time <= Date.now();
}

/**
 * Prints a refusal and ends the process, before anything is written.
 *
 * @param message - What was refused, without the program name
 */
function fail(message) {
    console.error(`versions.mjs: ${message}`);
    process.exit(1);
}

/**
 * Records the release date of a version in the .versions.json of its project.
 * The file sits next to the version directories, so it stays out of file listings, archives and checksums; the server
 * reads the date of each version on its own and ignores the order of the keys.
 *
 * @param argv - Command line arguments as passed by fetch.sh: <file> <version> <date>, the folder of the file being
 * created when it is missing; exits with status 1 and leaves the file alone when one is missing, when the version is
 * not X.Y.Z or X.Y.Z-tag, when the date is not a real day from 1970 to today (UTC), or when an existing file is not a
 * JSON object
 */
export function main(argv) {
    const [file, version, date] = argv;
    if (!file || !version || !date) fail('usage: node scripts/versions.mjs <file> <version> <date>');
    if (!isVersion(version)) fail(`${version} is not an exact version (X.Y.Z or X.Y.Z-tag).`);
    if (!isDay(date)) fail(`${date} is not a real YYYY-MM-DD day from 1970 to today (UTC).`);

    let data = {};
    if (fs.existsSync(file)) {
        try {
            data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch (error) {
            fail(`${file} is not valid JSON: ${error.message}`);
        }
        if (typeof data !== 'object' || data === null || Array.isArray(data))
            fail(`${file} is not an object of versions.`);
    }

    data[version] = { date };
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 4) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
