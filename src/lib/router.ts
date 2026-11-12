import type { Match } from '../types/index.js';

// First segments that name a route of their own, so a package type cannot use them
export const RESERVED = ['download', 'health', 'manifest', 'search'];

/**
 * Tells whether a name can be one segment of a path that the router matches.
 * A name that is empty, is a dot segment, or holds a '/', a '\\' or a control character never reaches a route, since the
 * router refuses the decoded segment, so a file or a folder of that name could be listed and archived but not served.
 *
 * @param name - Decoded name, such as a folder or a file name
 * @returns True when the router can match the name as one segment
 */
export function isSegment(name: string): boolean {
    return name !== '' && name !== '.' && name !== '..' && !/[\\/]|\p{Cc}/u.test(name);
}

/**
 * Tells whether a folder name can be a package type or a project.
 * The name ends up in a URL, in the file name of an archive and in a header, so it is kept to letters, digits, '.', '_'
 * and '-' and does not start with a dot (which also keeps hidden folders out); the router cuts a project segment at its
 * last '@', and the listing of a type holds a 'list' key next to its projects.
 *
 * @param name - Folder name at the top of the packages tree or inside a type folder
 * @returns True for an ASCII name that does not start with a dot or a dash
 */
export function isName(name: string): boolean {
    return /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(name);
}

/**
 * Tells whether a name can be a project.
 *
 * @param name - Folder name inside a type folder
 * @returns True for a name that isName accepts, which is not 'list'
 */
export function isProjectName(name: string): boolean {
    return isName(name) && name !== 'list';
}

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
    if (!segments.every(isSegment)) return { id: 'unknown' };

    const [first, second, third] = segments;
    const { length } = segments;
    if (length === 0) return { id: 'root' };
    if (first === 'search' || first === 'health' || first === 'manifest') {
        return length === 1 && !slash ? { id: first } : { id: 'unknown' };
    }
    if (first === 'download') {
        if (length === 1) return { id: 'downloads' };
        if (length === 2) return { id: 'typeDownloads', type: second };
        if (length > 3 || slash) return { id: 'unknown' };

        const [name, version] = splitProject(third);
        return { id: 'archive', type: second, name, version };
    }

    if (first === '-' && second === 'docs') {
        if (length === 2) return { id: 'docs', page: null };

        return length === 3 && !slash ? { id: 'docs', page: third } : { id: 'unknown' };
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
