import type { CatalogVersion, IndexDir, IndexFile, Resolved } from '../types/index.js';

// Link crossings a path may take, the kernel's own limit past which it fails with ELOOP
export const MAX_LINKS = 40;

/**
 * Resolves the '', '.' and '..' segments of an untrusted path without the disk, and keeps it inside a base folder.
 * The segments are resolved on a stack that starts with the base, so a path may leave the base and come back.
 *
 * @param file - Untrusted path from the URL, already decoded, '/' being the only separator
 * @param base - Segments of the base folder under the packages root, such as [type, project, version]
 * @returns The path relative to the base, '' for the base itself, or null when it holds a NUL character, climbs above
 * the packages root or ends outside the base
 */
export function normalizePath(file: string, base: string[]): string | null {
    if (file.includes('\0')) return null;

    const stack = [...base];
    for (const segment of file.split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment !== '..') stack.push(segment);
        else if (stack.length === 0) return null;
        else stack.pop();
    }

    if (base.some((segment, i) => stack[i] !== segment)) return null;

    return stack.slice(base.length).join('/');
}

/**
 * Walks a path through the index of a version, following links only while their target stays inside the version.
 * The file and folder routes share this rule, so a link out of a version is never served nor listed.
 *
 * @param version - Version whose nodes are walked, the link targets looked up by their real path
 * @param path - Path relative to the version folder as normalizePath returns it, '' for the folder itself
 * @returns The folder or file reached, its real path relative to the version folder and how many links were crossed,
 * or null when a segment is missing, sits below a file or a folder that could not be read, or crosses a link that
 * dangles, escapes or loops
 */
export function resolvePath(version: CatalogVersion, path: string): Resolved | null {
    let node: IndexDir | IndexFile = version.root;
    let real = '';
    let hops = 0;

    for (const name of path === '' ? [] : path.split('/')) {
        if (node.kind !== 'dir' || node.entries === null) return null;

        const childPath = real === '' ? name : `${real}/${name}`;
        const child = version.nodes.get(childPath);
        if (!child) return null;
        if (child.kind !== 'link') {
            node = child;
            real = childPath;
            continue;
        }
        if (child.real === null) return null;

        const target = version.nodes.get(child.real);
        if (!target || target.kind === 'link') return null;

        node = target;
        real = child.real;
        hops++;
    }

    return { node, path: real, hops };
}
