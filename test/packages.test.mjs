import assert from 'assert/strict';
import fs from 'fs';
import { after, before, describe, test } from 'node:test';
import { join } from 'path';
import { setTimeout } from 'timers/promises';

import { request, rootDir, sha256, startServer } from './server.mjs';
import { readArchive } from './tar.mjs';

const packagesDir = join(rootDir, 'packages');

/**
 * Lists the folders of a directory that the server scans, hidden ones aside.
 *
 * @param dir - Directory to read, a type or a project folder of packages/
 * @returns Folder names, sorted
 */
function folders(dir) {
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort();
}

/**
 * Hashes every regular file of a version straight from the disk, as the reference for the server's answers.
 *
 * @param dir - Version folder, walked recursively
 * @param base - Prefix removed from the keys, only passed by the recursive calls
 * @returns Map of paths relative to the version folder to their SHA-256
 */
function hashTree(dir, base = dir) {
    const hashes = {};

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) Object.assign(hashes, hashTree(path, base));
        else if (entry.isFile()) hashes[path.slice(base.length + 1)] = sha256(fs.readFileSync(path));
    }

    return hashes;
}

/**
 * Sends a GET request, waiting out the global rate limit when a large tree exceeds it.
 *
 * @param port - Port of the server started for the real tree
 * @param path - Request target, already percent-encoded
 * @returns The response, after at most three waits of one rate limit window
 */
async function get(port, path) {
    for (let attempt = 0; ; attempt++) {
        const response = await request(port, 'GET', path);
        if (response.status !== 429 || attempt === 3) return response;

        await setTimeout(10_000);
    }
}

describe('packages/', () => {
    let server;

    before(async () => {
        server = await startServer();
    });

    after(() => server?.stop());

    test('every type is listed', async () => {
        const { body } = await get(server.port, '/');

        assert.deepEqual(Object.keys(JSON.parse(body).packages).sort(), folders(packagesDir));
    });

    for (const type of folders(packagesDir)) {
        for (const project of folders(join(packagesDir, type))) {
            test(`${type}/${project}`, async () => {
                const versions = folders(join(packagesDir, type, project));
                const listing = JSON.parse((await get(server.port, `/${type}/${project}`)).body);
                const changelog = JSON.parse((await get(server.port, `/${type}/${project}/changelog`)).body);

                assert.deepEqual(Object.keys(listing.versions).sort(), ['latest', ...versions].sort());
                assert.equal(changelog.versions, versions.length);

                for (const version of versions) {
                    const expected = hashTree(join(packagesDir, type, project, version));
                    const checksums = await get(server.port, `/${type}/${project}@${version}?checksums`);
                    const archive = await get(server.port, `/download/${type}/${project}@${version}`);

                    assert.equal(checksums.status, 200, `${version}?checksums`);
                    assert.deepEqual(JSON.parse(checksums.body).checksums, expected, `${version}?checksums`);

                    assert.equal(archive.status, 200, `${version} archive`);
                    assert.equal(archive.aborted, false, `${version} archive`);
                    const files = readArchive(archive.body).filter((entry) => entry.type === 'file');
                    const archived = Object.fromEntries(files.map((e) => [e.path.slice(version.length + 1), e.sha256]));
                    assert.deepEqual(archived, expected, `${version} archive`);

                    const first = Object.keys(expected).sort()[0];
                    if (!first) continue;

                    const path = first.split('/').map(encodeURIComponent).join('/');
                    const file = await get(server.port, `/${type}/${project}@${version}/${path}`);
                    assert.equal(file.status, 200, `${version}/${first}`);
                    assert.equal(sha256(file.body), expected[first], `${version}/${first}`);
                }
            });
        }
    }
});
