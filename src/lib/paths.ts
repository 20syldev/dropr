import type { CatalogDir, CatalogVersion, IndexFile, IndexLink, Resolved } from '../types/index.js';

// Link crossings a path may take, which bounds the work of one request: the length of the URL alone allows thousands
export const MAX_LINKS = 40;

/**
 * Follows a link of a version to what it leads to.
 * A link keeps its real path only while its target is a file or a folder inside the version, which loadIndex checked.
 *
 * @param version - Version holding the link, whose nodes are looked up by real path
 * @param link - Link node of that version
 * @returns The folder or file the link leads to, or undefined for a link that dangles, loops or leaves the version
 */
export function followLink(version: CatalogVersion, link: IndexLink): CatalogDir | IndexFile | undefined {
    if (link.real === undefined) return undefined;

    return version.nodes.get(link.real) as CatalogDir | IndexFile;
}

/**
 * Walks a path through the index of a version, following links only while their target stays inside the version.
 * The file and folder routes share this rule, so a link out of a version is never served nor listed.
 *
 * @param version - Version whose nodes are walked, the link targets looked up by their real path
 * @param path - Decoded path relative to the version folder, its segments joined with '/', '' for the folder itself
 * @returns The folder or file reached and its real path relative to the version folder, or null when a segment is
 * missing, sits below a file, or crosses a link that dangles, escapes or loops, or when the path crosses more than
 * MAX_LINKS links
 */
export function resolvePath(version: CatalogVersion, path: string): Resolved | null {
    let node: CatalogDir | IndexFile = version.root;
    let real = '';
    let hops = 0;

    for (const name of path === '' ? [] : path.split('/')) {
        if (node.kind !== 'dir') return null;

        const childPath = real === '' ? name : `${real}/${name}`;
        const child = version.nodes.get(childPath);
        if (!child) return null;
        if (child.kind !== 'link') {
            node = child;
            real = childPath;
            continue;
        }

        const target = followLink(version, child);
        if (!target || ++hops > MAX_LINKS) return null;

        node = target;
        real = child.real as string;
    }

    return { node, path: real };
}
