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
