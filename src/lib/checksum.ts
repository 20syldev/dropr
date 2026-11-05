import type { CatalogDir, CatalogVersion } from '../types/index.js';

import { followLink } from './paths.js';

/**
 * Adds the SHA-256 of every file below a folder of a version to a list, in pre-order and byte order.
 * A link counts as its target file while the target stays inside the version; links to folders are skipped.
 *
 * @param version - Version holding the folder, whose nodes resolve the link targets
 * @param dir - Folder to walk, its subfolders included
 * @param path - Path of dir relative to the version folder, '' for the version folder itself
 * @param pairs - List filled in place with the path of each file and its hex digest
 */
function collect(version: CatalogVersion, dir: CatalogDir, path: string, pairs: [string, string][]): void {
    for (const node of dir.entries) {
        const child = path === '' ? node.name : `${path}/${node.name}`;
        if (node.kind === 'dir') {
            collect(version, node, child, pairs);
            continue;
        }

        const target = node.kind === 'link' ? followLink(version, node) : node;
        if (target?.kind === 'file') pairs.push([child, target.sha256]);
    }
}

/**
 * Reads the SHA-256 of every file of a version from its index, hashed once at scan.
 *
 * @param version - Version whose files are listed, through the links that stay inside it
 * @returns Pairs of a file path relative to the version folder (no leading slash) and its hex digest, in the pre-order
 * of the archive: byte order inside each folder, a folder's files where the folder sorts among its siblings
 */
export function checksums(version: CatalogVersion): [string, string][] {
    const pairs: [string, string][] = [];
    collect(version, version.root, '', pairs);

    return pairs;
}
