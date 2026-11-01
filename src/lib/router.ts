import type { Match } from '../types/index.js';

// First segments that name a route of their own, so a package type cannot use them
export const RESERVED = ['download', 'health', 'manifest', 'search'];

/**
 * Splits a project segment into its name and its version at the last '@'.
 * An '@' in first or last place is no separator, so such a segment stays a name that no project holds.
 *
 * @param segment - Decoded segment, such as lib or lib@1.2, which holds no '/'
 * @returns The name and the version, the version being null when the segment names none, even if it holds an '@'
 */
function splitProject(segment: string): [string, string | null] {
    const at = segment.lastIndexOf('@');
    if (at < 1 || at === segment.length - 1) return [segment, null];

    return [segment.slice(0, at), segment.slice(at + 1)];
}

/**
 * Matches the path of a request to a route, deciding its percent-encoding, its empty segments and its trailing slash.
 * Every segment is decoded once, so the path never holds a second layer of encoding, and a segment that decodes to
 * an empty string, a '/', a '\', or a control character matches no route. Literals are matched in lower case only.
 *
 * @param pathname - Path of a WHATWG URL, which already resolved the '.' and '..' segments and turned '\' into '/'
 * @returns The route with its decoded parts, 'encoding' when a segment is not valid percent-encoding, which wins
 * over 'unknown', or 'unknown' when no route has this shape
 */
export function matchPath(pathname: string): Match {
    const raw = pathname === '/' ? [] : pathname.slice(1).split('/');
    const slash = raw.length > 0 && raw[raw.length - 1] === '';
    if (slash) raw.pop();

    const segments: string[] = [];
    for (const part of raw) {
        try {
            segments.push(decodeURIComponent(part));
        } catch {
            return { id: 'encoding' };
        }
    }
    if (segments.some((segment) => segment === '' || /[\\/]|\p{Cc}/u.test(segment))) return { id: 'unknown' };

    const [first, second, third] = segments;
    const { length } = segments;
    if (length === 0) return { id: 'root' };
    if (first === 'search') return length === 1 && !slash ? { id: 'search' } : { id: 'unknown' };
    if (first === 'download') {
        if (length === 1) return { id: 'downloads' };
        if (length === 2) return { id: 'typeDownloads', type: second };
        if (length > 3 || slash) return { id: 'unknown' };

        const [name, version] = splitProject(third);
        return { id: 'archive', type: second, name, version };
    }

    if (length === 1) return { id: 'type', type: first };

    const [name, version] = splitProject(second);
    if (length === 2) {
        return version === null ? { id: 'versions', type: first, name } : { id: 'version', type: first, name, version };
    }
    if (version === null) {
        return length === 3 && third === 'changelog' && !slash
            ? { id: 'changelog', type: first, name }
            : { id: 'beneath', type: first, name };
    }

    return { id: 'file', type: first, name, version, path: segments.slice(2).join('/'), slash };
}
