import fs from 'fs';
import os from 'os';
import { dirname, join } from 'path';

// Date given to every entry (2025-01-01T12:00:00Z), so ETags and the changelog mtime fallback never change
const TIME = 1735732800;

// Files of the generated tree, by path under the fixture root; secret.txt sits outside packages/ on purpose
const FILES = {
    'secret.txt': 'outside the packages tree\n',
    'packages/.hidden/tool/1.0.0/a.txt': 'hidden folder, not a type\n',
    'packages/bash/gft/.versions.json': '{ "1.0.0": { "date": "2025-03-01" }, "1.1.0": { "date": "2025-04-15" } }\n',
    'packages/bash/gft/1.0.0/gft': '#!/bin/bash\necho "gft 1.0.0"\n',
    'packages/bash/gft/1.1.0/gft': '#!/bin/bash\necho "gft 1.1.0"\n',
    'packages/bash/gft/1.2.0/README.md': '# gft\n',
    'packages/bash/gft/1.2.0/gft': '#!/bin/bash\necho "gft 1.2.0"\n',
    'packages/config/styles/1.0.0/data.json': '{ "b": 1, "a": 2 }\n',
    'packages/config/styles/1.0.0/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
    'packages/config/styles/1.0.0/theme.css': ':root { color: red; }\n',
    'packages/download/tool/1.0.0/a.txt': 'reserved name, not a type\n',
    'packages/node_modules/tool/1.0.0/a.txt': 'excluded name, not a type\n',
    'packages/npm/README.md': 'a file next to the projects\n',
    'packages/npm/bash-utils/1.0.0/index.js': 'export default "bash-utils";\n',
    'packages/npm/broken/1.0.0/index.js': 'export default "broken";\n',
    'packages/npm/broken/1.0.0/locked.bin': 'unreadable once locked\n',
    'packages/npm/lib/.versions.json':
        '{ "1.0.0": { "date": "2025-02-01" }, "1.2.0": { "date": "2025-05-01" }, "2.0.0-pre": { "date": "2025-09-01" } }\n',
    'packages/npm/lib/1.0.0/index.js': 'export default "1.0.0";\n',
    'packages/npm/lib/1.0.0/package.json': '{ "name": "lib", "version": "1.0.0" }\n',
    'packages/npm/lib/1.2.0/.npmignore': 'src/\n',
    'packages/npm/lib/1.2.0/dist/index.d.ts': 'declare const version: string;\nexport default version;\n',
    'packages/npm/lib/1.2.0/dist/index.mjs': 'export default "1.2.0";\n',
    'packages/npm/lib/1.2.0/dist/nested/deep.cjs': 'module.exports = "deep";\n',
    'packages/npm/lib/1.2.0/index.js': 'export default "1.2.0";\n',
    'packages/npm/lib/1.2.0/package.json': '{ "name": "lib", "version": "1.2.0" }\n',
    'packages/npm/lib/1.10.0/index.js': 'export default "1.10.0";\n',
    'packages/npm/lib/2.0.0-pre/index.js': 'export default "2.0.0-pre";\n',
    'packages/npm/links/1.0.0/dist/file.js': 'export default "file";\n',
    'packages/npm/links/1.0.0/index.js': 'export default "links";\n',
    'packages/npm/list/1.0.0/index.js': 'reserved name, not a project\n',
    'packages/npm/next/0.1.0-beta.2/index.js': 'export default "0.1.0-beta.2";\n',
    'packages/npm/next/0.1.0-beta.10/index.js': 'export default "0.1.0-beta.10";\n',
    'packages/npm/old/.deprecated.json':
        '{ "date": "2025-06-01", "message": "Renamed to lib.", "successor": "https://dropr.sylvain.sh/npm/lib" }\n',
    'packages/npm/old/1.0.0/index.js': 'export default "old";\n',
    'packages/npm/sealed/1.0.0/index.js': 'export default "sealed";\n',
};

// Symlinks of the links project, by path under the fixture root, mapped to their target as written in the link
const LINKS = {
    'packages/npm/links/1.0.0/dangling': 'missing.js',
    'packages/npm/links/1.0.0/dist/loop': '..',
    'packages/npm/links/1.0.0/folder': 'dist',
    'packages/npm/links/1.0.0/inside': 'index.js',
    'packages/npm/links/1.0.0/outside': '../../../../secret.txt',
    'packages/npm/links/1.0.0/sibling': '../../lib/1.0.0/index.js',
};

// File made unreadable, so that tar fails on it
const LOCKED = 'packages/npm/broken/1.0.0/locked.bin';

/**
 * Tells whether the current user can read a path, which a mode of 000 does not prevent for root.
 *
 * @param path - File or folder to check
 * @returns False when reading it fails with any error, EACCES included
 */
export function isReadable(path) {
    try {
        fs.accessSync(path, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Creates a folder and its missing parents, recording each folder it creates.
 *
 * @param path - Folder to create, left as is when it already exists
 * @param created - Paths created so far in creation order, appended to
 */
function makeDir(path, created) {
    if (fs.existsSync(path)) return;

    makeDir(dirname(path), created);
    fs.mkdirSync(path);
    created.push(path);
}

/**
 * Deletes the entries of a fixture in reverse creation order, so children go before their folder.
 * Folders go through rmdir, which refuses a folder that is not empty, so nothing the fixture did not write is deleted.
 *
 * @param created - Paths in creation order, as recorded by createFixture
 */
function removeEntries(created) {
    for (const path of [...created].reverse()) {
        if (fs.lstatSync(path).isDirectory()) fs.rmdirSync(path);
        else fs.unlinkSync(path);
    }
}

/**
 * Writes the generated packages tree into a new temporary folder.
 * Dates are set once the whole tree is written, since each write moves the mtime of its folder.
 *
 * @returns The fixture root, its packages folder, locked set to false when LOCKED stays readable (as for root), and
 * remove() which deletes exactly the entries written here
 */
export function createFixture() {
    const root = fs.mkdtempSync(join(os.tmpdir(), 'dropr-test-'));
    const created = [root];

    for (const [path, content] of Object.entries(FILES)) {
        const file = join(root, path);
        makeDir(dirname(file), created);
        fs.writeFileSync(file, content);
        created.push(file);
    }
    for (const [path, target] of Object.entries(LINKS)) {
        const link = join(root, path);
        makeDir(dirname(link), created);
        fs.symlinkSync(target, link);
        created.push(link);
    }
    for (const path of created) fs.lutimesSync(path, TIME, TIME);

    fs.chmodSync(join(root, LOCKED), 0o000);
    const locked = !isReadable(join(root, LOCKED));

    return { root, packagesDir: join(root, 'packages'), locked, remove: () => removeEntries(created) };
}
