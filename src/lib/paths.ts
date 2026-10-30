import fs from 'fs';
import { join, resolve, sep } from 'path';

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
