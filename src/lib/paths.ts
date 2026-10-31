import fs from 'fs';
import { join, resolve, sep } from 'path';

import type { CatalogVersion, IndexDir, IndexFile, Resolved } from '../types/index.js';

// Link crossings a path may take, the kernel's own limit past which it fails with ELOOP
export const MAX_LINKS = 40;

/**
 * Joins untrusted segments onto a base directory and ensures the result stays inside it.
 * Blocks directory traversal through '..' segments and null bytes, but does not follow symlinks.
 *
 * @param base - Trusted base directory, resolved to an absolute path before the check
 * @param segments - Untrusted path segments, such as a file path taken from the URL
 * @returns The resolved absolute path (the base itself included), or null if it escapes the base or holds a null byte
 */
export function safeJoin(base: string, ...segments: string[]): string | null {
    if (segments.some((segment) => segment.includes('\0'))) return null;

    const root = resolve(base);
    const target = resolve(join(root, ...segments));

    if (target !== root && !target.startsWith(root + sep)) return null;

    return target;
}

/**
 * Stats a path inside a version folder, following symlinks only while their target stays in that folder.
 * Files, listings, sizes and checksums share this rule, so a symlink out of a version is never read nor measured.
 *
 * @param base - Version folder the target must stay in, its own path resolved through symlinks too
 * @param path - Absolute path inside base, which may be a symlink or sit below one
 * @returns The stats of the path or of its target, or null when the target escapes base, dangles or cannot be read
 */
export function statInside(base: string, path: string): fs.Stats | null {
    try {
        const root = fs.realpathSync(base);
        const real = fs.realpathSync(path);
        if (real !== root && !real.startsWith(root + sep)) return null;

        return fs.statSync(real);
    } catch {
        // ENOENT for a dangling symlink, ENOTDIR when a file is used as a folder (package.json/x): both are missing
        return null;
    }
}

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
