import fs from 'fs';
import os from 'os';
import { dirname, join } from 'path';

/**
 * A small packages tree for the READMEs, removed by remove().
 */
export interface DocsTree {
    packagesDir: string;
    remove: () => void;
}

// Files of the tree, by path under the packages folder
const FILES: Record<string, string> = {
    'docs/readme/.versions.json': '{ "1.0.0": { "date": "2025-01-01" }, "2.0.0": { "date": "2025-02-01" } }\n',
    'docs/readme/1.0.0/README.md':
        '# Café\n\nSee [guide](docs/guide.md), [top](/top) and ![shot](shot.png) <script>alert(1)</script>.\n',
    'docs/readme/1.0.0/docs/guide.md': 'guide\n',
    'docs/readme/2.0.0/notes/real.md': '# Real notes\n',
    'docs/huge/.versions.json': '{ "1.0.0": { "date": "2025-01-01" } }\n',
    'docs/huge/1.0.0/README.md': `# Huge\n\n${'x'.repeat(262144)}\n`,
    'docs/lying/.versions.json': '{ "1.0.0": { "date": "2025-01-01" } }\n',
    'docs/lying/1.0.0/README.md': '# Lying\n',
    'docs/old/.deprecated.json': '{ "date": "2025-06-01", "message": "Moved", "successor": "/docs/readme" }\n',
    'docs/old/.versions.json': '{ "1.0.0": { "date": "2025-01-01" } }\n',
    'docs/old/1.0.0/index.js': 'export default 1;\n',
};

// Links of the tree, by path under the packages folder, mapped to their target as written in the link
const LINKS: Record<string, string> = {
    'docs/readme/2.0.0/README.markdown': 'notes/real.md',
};

/**
 * Writes the tree into a new temporary folder.
 *
 * @returns The packages folder, and remove() which deletes exactly what was written, folders through rmdir
 */
export function createDocsTree(): DocsTree {
    const root = fs.mkdtempSync(join(os.tmpdir(), 'dropr-docs-'));
    const packagesDir = join(root, 'packages');
    const created: string[] = [root, packagesDir];
    fs.mkdirSync(packagesDir);

    for (const path of [...Object.keys(FILES), ...Object.keys(LINKS)]) {
        let folder = dirname(join(packagesDir, path));
        const missing: string[] = [];
        while (!fs.existsSync(folder)) {
            missing.unshift(folder);
            folder = dirname(folder);
        }
        for (const dir of missing) {
            fs.mkdirSync(dir);
            created.push(dir);
        }
    }
    for (const [path, content] of Object.entries(FILES)) {
        fs.writeFileSync(join(packagesDir, path), content);
        created.push(join(packagesDir, path));
    }
    for (const [path, target] of Object.entries(LINKS)) {
        fs.symlinkSync(target, join(packagesDir, path));
        created.push(join(packagesDir, path));
    }

    return {
        packagesDir,
        remove() {
            for (const path of [...created].reverse()) {
                if (fs.lstatSync(path).isDirectory()) fs.rmdirSync(path);
                else fs.unlinkSync(path);
            }
        },
    };
}
