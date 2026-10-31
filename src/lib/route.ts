import type {
    Catalog,
    CatalogVersion,
    Deprecation,
    FileEntry,
    IndexNode,
    PackageProject,
    RouteRequest,
    RouteResponse,
} from '../types/index.js';

import { archiveEntries } from './archive.js';
import { checksums } from './checksum.js';
import { deprecationHeaders } from './deprecations.js';
import { errorBody } from './errors.js';
import { contentType } from './mime.js';
import { getProject, hasType, latestVersion, listProjects, resolveVersion, searchPackages } from './packages.js';
import { MAX_LINKS, normalizePath, resolvePath } from './paths.js';

interface Scope {
    request: RouteRequest;
    catalog: Catalog;
    headers: Record<string, string>;
    name: string;
    version: string | null;
    pinned: boolean;
    deprecated?: Deprecation;
}

type Handler = (scope: Scope, params: string[]) => RouteResponse | undefined;

// Message of every 500, which never names a server path
export const INTERNAL = 'An unexpected error occurred.';

// Patterns of the 3.3.1 Express stack, as path-to-regexp 8.4.2 compiles them for router 2.2.0
const LAYERS: [RegExp, Handler][] = [
    [/^(?:\/search)(?:\/$)?$/i, searchRoute],
    [/^(?:\/download)(?:\/$)?$/i, downloadsRoute],
    [/^(?:\/download\/([^/]+))(?:\/$)?$/i, typeDownloadsRoute],
    [/^(?:\/download\/([^/]+)\/([^/]+))(?:\/$)?$/i, archiveRoute],
    [/^(?:\/([^/]+))(?:\/$)?(?=\/|$)/i, typeGuard],
    [/^(?:\/([^/]+)\/([^/]+)\/changelog)(?:\/$)?$/i, changelogRoute],
    [/^(?:\/([^/]+)\/([^/]+))(?:\/$)?(?=\/|$)/i, projectGuard],
    [/^(?:\/([^/]+)\/([^/]+)\/([^]+))(?:\/$)?(?=\/|$)/i, fileRoute],
    [/^(?:\/)(?:\/$)?$/i, rootRoute],
    [/^(?:\/([^/]+))(?:\/$)?$/i, typeRoute],
    [/^(?:\/([^/]+)\/([^/]+))(?:\/$)?$/i, versionRoute],
];

/**
 * Builds a JSON response, indented with 2 spaces like every answer of the server.
 *
 * @param status - HTTP status code
 * @param data - Value to serialize, its undefined fields left out
 * @param headers - Headers set before the body, such as Deprecation and Link, kept in their order
 * @returns The response, its Content-Type JSON in UTF-8, replacing any Content-Type of headers in place
 */
export function json(status: number, data: unknown, headers: Record<string, string> = {}): RouteResponse {
    return {
        status,
        headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
        body: { kind: 'json', text: JSON.stringify(data, null, 2) },
    };
}

/**
 * Builds an error response with the unified JSON body of the server.
 *
 * @param status - HTTP error status, from 400 to 599, echoed in the body with its reason phrase
 * @param message - Human readable explanation of the error, which never names a server path
 * @param headers - Headers set before the error, kept as 3.3.1 kept them, such as Deprecation, Link or Allow
 * @returns The JSON response of the error body
 */
export function failure(status: number, message: string, headers: Record<string, string> = {}): RouteResponse {
    return json(status, errorBody(status, message), headers);
}

/**
 * Decodes one segment of a route parameter as router 2.2.0 does.
 *
 * @param segment - Raw segment, without a slash
 * @returns The decoded segment; throws a URIError carrying the 400 message of router when it does not decode
 */
function decodeParam(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        throw new URIError(`Failed to decode param '${segment}'`);
    }
}

/**
 * Decodes the captures of a layer pattern as router 2.2.0 decodes route parameters.
 * Each capture is decoded segment by segment, which only matters for the *file wildcard, the one that holds slashes.
 *
 * @param captures - Raw captures of the pattern, in order
 * @returns The decoded captures, their segments joined back with '/'; throws a URIError naming the first segment that
 * does not decode
 */
function decode(captures: string[]): string[] {
    return captures.map((capture) => capture.split('/').map(decodeParam).join('/'));
}

/**
 * Builds the download links of every version of a project.
 *
 * @param type - Package type folder name (e.g. npm), inserted as is in the URLs
 * @param name - Project name without its version suffix, inserted as is in the URLs
 * @param entry - Project entry, its deprecation notice and its version keys other than the 'latest' alias are read
 * @returns The deprecation notice, the latest archive URL and one URL per version
 */
function downloadLinks(type: string, name: string, entry: PackageProject): Record<string, unknown> {
    const versions = Object.keys(entry.versions).filter((v) => v !== 'latest');

    return {
        deprecated: entry.deprecated,
        latest: `/download/${type}/${name}`,
        versions: versions.reduce<Record<string, string>>((acc, v) => {
            acc[v] = `/download/${type}/${name}@${v}`;
            return acc;
        }, {}),
    };
}

/**
 * Lists the entries of a folder of a version, with their size.
 * A link shows as its target while the target stays inside the version, other links are left out since the file
 * route refuses them.
 *
 * @param version - Version holding the folder, whose nodes resolve the link targets
 * @param entries - Entries of a folder that could be read, in strcmp order
 * @param linked - True when the folder was reached through a link, which gives each of its folders a null size
 * @returns Entries with a trailing slash on folder names and their size in bytes, cumulative for a folder and null
 * when the folder could not be read whole, is a link or is reached through one
 */
function listing(version: CatalogVersion, entries: IndexNode[], linked: boolean): FileEntry[] {
    return entries.flatMap((node) => {
        const target = node.kind === 'link' && node.real !== null ? version.nodes.get(node.real) : node;
        if (!target || target.kind === 'link') return [];
        if (target.kind === 'file') return { name: node.name, size: target.size, directory: false };

        return { name: `${node.name}/`, size: linked || node.kind === 'link' ? null : target.size, directory: true };
    });
}

/**
 * Answers a download with the archive of a version, the caller streaming its entries after the headers.
 *
 * @param scope - Request state, its headers (Deprecation and Link) kept before the archive ones
 * @param type - Package type of the version
 * @param name - Project name, which starts the archive file name
 * @param version - Exact version, or null for the latest of a project without versions, printed as is in the file name
 * @returns A 200 without Content-Length, ETag or Cache-Control, its entries null when the version is unknown or has a
 * folder that could not be listed, so that the stream fails at once
 */
function archiveResponse(scope: Scope, type: string, name: string, version: string | null): RouteResponse {
    const key = `${type}/${name}/${version}`;
    const entry = scope.catalog.versions.get(key);

    return {
        status: 200,
        headers: {
            ...scope.headers,
            'Content-Type': 'application/gzip',
            'Content-Disposition': `attachment; filename="${name}-${version}.tar.gz"`,
        },
        body: { kind: 'archive', key, entries: entry ? archiveEntries(entry) : null },
    };
}

/**
 * Answers /search with the projects whose name holds the query, then every project of the type it names.
 *
 * @param scope - Request state, its q query parameter trimmed, a repeated q counting as missing
 * @returns 200 with the query, the count and the results, or 400 when q is missing or blank
 */
function searchRoute(scope: Scope): RouteResponse {
    const raw = scope.request.query.q;
    const query = typeof raw === 'string' ? raw.trim() : '';
    if (query.length === 0) return failure(400, 'Missing required query parameter: q');

    const results = searchPackages(scope.catalog.packages, query);

    return json(200, { query, count: results.length, results });
}

/**
 * Answers /download with the archive links of every project of every type.
 *
 * @param scope - Request state, whose packages are listed in scan order
 * @returns 200 with the message and the links by type and project
 */
function downloadsRoute(scope: Scope): RouteResponse {
    const { packages } = scope.catalog;
    const downloads: Record<string, Record<string, unknown>> = {};
    for (const type of Object.keys(packages)) {
        downloads[type] = {};
        for (const [project, entry] of listProjects(packages, type)) {
            downloads[type][project] = downloadLinks(type, project, entry);
        }
    }

    return json(200, { message: 'Available packages for download (.tar.gz).', downloads });
}

/**
 * Answers /download/{type} with the archive links of every project of a type.
 *
 * @param scope - Request state, whose packages are searched for own keys only
 * @param params - Decoded type
 * @returns 200 with the message and the links by project, or 404 when the type does not exist
 */
function typeDownloadsRoute(scope: Scope, params: string[]): RouteResponse {
    const [type] = params;
    const { packages } = scope.catalog;
    if (!hasType(packages, type)) return failure(404, `Package type '${type}' does not exist.`);

    const downloads: Record<string, unknown> = {};
    for (const [project, entry] of listProjects(packages, type)) {
        downloads[project] = downloadLinks(type, project, entry);
    }

    return json(200, { message: `Downloadable ${type} packages (.tar.gz).`, downloads });
}

/**
 * Answers /download/{type}/{project}[@{version}] with the archive of a version, the latest one by default.
 * It is the browser-friendly alias of /{type}/{project}@{version}?download, without a query string.
 *
 * @param scope - Request state, given the Deprecation and Link headers of a deprecated project
 * @param params - Decoded type and project, the version after the first '@' being exact or partial
 * @returns The archive response, or 404 when the project or the version does not exist
 */
function archiveRoute(scope: Scope, params: string[]): RouteResponse {
    const [type, project] = params;
    const [name, version] = project.split('@');
    const entry = getProject(scope.catalog.packages, type, name);
    if (!entry) return failure(404, `Project '${name}' does not exist in /${type}.`);

    if (entry.deprecated) Object.assign(scope.headers, deprecationHeaders(entry.deprecated));

    let resolved: string | null = version || 'latest';
    if (resolved === 'latest') {
        resolved = latestVersion(entry);
    } else if (!Object.hasOwn(entry.versions, resolved)) {
        const match = resolveVersion(resolved, entry);
        if (!match) return failure(404, `Version ${resolved} does not exist in the '${name}' project.`, scope.headers);
        resolved = match;
    }

    return archiveResponse(scope, type, name, resolved);
}

/**
 * Stops every path under a package type that does not exist.
 *
 * @param scope - Request state, whose packages are searched for own keys only
 * @param params - Decoded type, the first segment of the path
 * @returns 404 when the type does not exist, else undefined so that a later layer answers
 */
function typeGuard(scope: Scope, params: string[]): RouteResponse | undefined {
    const [type] = params;
    if (!hasType(scope.catalog.packages, type)) return failure(404, `Package type '${type}' does not exist.`);

    return undefined;
}

/**
 * Answers /{type}/{project}/changelog with every version of a project and its release date.
 * The changelog covers every version, so a version given after '@' is ignored.
 *
 * @param scope - Request state, given the Deprecation and Link headers of a deprecated project
 * @param params - Decoded type and project
 * @returns 200 with the versions in listing order and their date from the index, or 404 when the project does not
 * exist
 */
function changelogRoute(scope: Scope, params: string[]): RouteResponse {
    const [type, project] = params;
    const [name] = project.split('@');
    const entry = getProject(scope.catalog.packages, type, name);
    if (!entry) return failure(404, `Project '${name}' does not exist in /${type}.`);

    if (entry.deprecated) Object.assign(scope.headers, deprecationHeaders(entry.deprecated));

    const changelog = Object.keys(entry.versions)
        .filter((version) => version !== 'latest')
        .map((version) => ({
            version,
            date: scope.catalog.versions.get(`${type}/${name}/${version}`)!.date,
            url: `/${type}/${name}@${version}`,
        }));
    const headers = { ...scope.headers, 'Cache-Control': 'public, max-age=300' };

    return json(200, { name, type, deprecated: entry.deprecated, versions: changelog.length, changelog }, headers);
}

/**
 * Resolves the project and the version of every /{type}/{project}[@{version}] path, or lists the project versions.
 * An exact version is pinned, so its files are immutable; latest and partial versions resolve to their newest match.
 *
 * @param scope - Request state, given the project name, its deprecation notice, the version and the pinned flag for
 * the routes after, and the Deprecation and Link headers of a deprecated project
 * @param params - Decoded type and project, the version after the first '@' and anything after a second '@' ignored
 * @returns 200 with the versions when the path names none, 404 when the project or the version does not exist, else
 * undefined so that the file or the version route answers
 */
function projectGuard(scope: Scope, params: string[]): RouteResponse | undefined {
    const [type, project] = params;
    const [name, version] = project.split('@');
    const entry = getProject(scope.catalog.packages, type, name);
    if (!entry) return failure(404, `Project '${name}' does not exist in /${type}.`);

    const { deprecated } = entry;
    if (deprecated) Object.assign(scope.headers, deprecationHeaders(deprecated));

    if (!version) {
        const versions = Object.keys(entry.versions).reduce<Record<string, string>>((acc, ver) => {
            acc[ver] = `/${type}/${name}@${ver}`;
            return acc;
        }, {});
        const message = `Available versions for the '${name}' project.`;

        return json(200, { message, deprecated, versions }, scope.headers);
    }

    scope.name = name;
    scope.deprecated = deprecated;
    if (version === 'latest') {
        // Null for a project without versions, which the file and version routes answer with a 500
        scope.version = latestVersion(entry);
    } else if (Object.hasOwn(entry.versions, version)) {
        scope.version = version;
        scope.pinned = true;
    } else {
        const match = resolveVersion(version, entry);
        if (!match) return failure(404, `Version ${version} does not exist in the '${name}' project.`, scope.headers);
        scope.version = match;
    }

    return undefined;
}

/**
 * Answers /{type}/{project}@{version}/{file} with a file or the listing of a folder of the version.
 * '..' segments and links are resolved inside the version only, so a path out of it reads as a missing file.
 *
 * @param scope - Request state set by projectGuard, its If-None-Match compared with the file ETag
 * @param params - Decoded type, project and file path, the path segments joined with '/'
 * @returns 200 with a listing or a file body, 304 when the ETag matches, 404 when the file is missing, out of the
 * version or past MAX_LINKS link crossings, or 500 for a null version or a folder past them or that could not be read
 */
function fileRoute(scope: Scope, params: string[]): RouteResponse {
    const [type, , file] = params;
    const { catalog, deprecated, name, version } = scope;
    const missing = `File '${file}' does not exist in the ${version} version of the '${name}' project.`;
    if (version === null) return failure(500, INTERNAL, scope.headers);

    const entry = catalog.versions.get(`${type}/${name}/${version}`);
    const path = normalizePath(file, [type, name, version]);
    const resolved = entry && path !== null ? resolvePath(entry, path) : null;
    if (!entry || path === null || !resolved) return failure(404, missing, scope.headers);

    const { node } = resolved;
    if (node.kind === 'dir') {
        if (resolved.hops > MAX_LINKS || node.entries === null) return failure(500, INTERNAL, scope.headers);

        const files = listing(entry, node.entries, resolved.hops > 0);

        return json(200, { name, version, path: file.replace(/\/$/, ''), deprecated, files }, scope.headers);
    }

    // Only an exact version is immutable: latest and partial versions move to the next release
    const cache = scope.pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
    const etag = `"${node.size.toString(16)}-${node.mtime.toString(16)}"`;
    const headers: Record<string, string> = { ...scope.headers, ETag: etag, 'Cache-Control': cache };
    if (scope.request.headers['if-none-match'] === etag) return { status: 304, headers, body: { kind: 'empty' } };

    headers['Content-Type'] = contentType(path);
    headers['X-Content-Type-Options'] = 'nosniff';

    // Past the kernel's link limit, sending the file fails with ELOOP, which 3.3.1 answered as a missing file
    if (resolved.hops > MAX_LINKS) {
        delete headers.ETag;
        delete headers['Cache-Control'];
        return failure(404, missing, headers);
    }

    // Rounded to the millisecond as Node's Stats.mtime is, which send read in 3.3.1
    headers['Last-Modified'] = new Date(Math.round(node.mtime)).toUTCString();

    return {
        status: 200,
        headers,
        body: {
            kind: 'file',
            path: `${type}/${name}/${version}/${resolved.path}`,
            size: node.size,
            mtime: node.mtime,
            missing,
            precondition: `Precondition failed for file '${file}'.`,
            range: `Range not satisfiable for file '${file}'.`,
        },
    };
}

/**
 * Answers / with the routes to start from and every package.
 *
 * @param scope - Request state, whose packages are listed whole
 * @returns 200 with the message, the route links and the packages object
 */
function rootRoute(scope: Scope): RouteResponse {
    return json(200, {
        message: 'Use the following routes to access the projects and their versions.',
        manifest: '/manifest',
        health: '/health',
        search: '/search?q=',
        download: '/download',
        packages: scope.catalog.packages,
    });
}

/**
 * Answers /{type} with the projects of a type that typeGuard found.
 *
 * @param scope - Request state, whose packages hold the type
 * @param params - Decoded type, its first character upper-cased in the message
 * @returns 200 with the message and the type entry, its 'list' key included
 */
function typeRoute(scope: Scope, params: string[]): RouteResponse {
    const [type] = params;

    return json(200, {
        message: `${type[0].toUpperCase() + type.slice(1)} projects.`,
        projects: scope.catalog.packages[type],
    });
}

/**
 * Answers /{type}/{project}@{version} with the files, the checksums or the archive of a version.
 * ?checksums wins over ?download in any order, and none of these answers sets Cache-Control.
 *
 * @param scope - Request state set by projectGuard, its checksums and download query parameters read for presence
 * @param params - Decoded type and project, the version coming from the scope
 * @returns 200 with the listing, the checksums or an archive body, or 500 for a null version, a version that could not
 * be listed or, for the checksums, one with a file that could not be read
 */
function versionRoute(scope: Scope, params: string[]): RouteResponse {
    const [type] = params;
    const { catalog, deprecated, name, request, version } = scope;
    if (version === null) return failure(500, INTERNAL, scope.headers);

    const entry = catalog.versions.get(`${type}/${name}/${version}`);

    if (request.query.checksums !== undefined) {
        const sums = entry ? checksums(entry) : null;
        if (!sums) return failure(500, INTERNAL, scope.headers);

        return json(200, { name, version, deprecated, algorithm: 'sha256', checksums: sums }, scope.headers);
    }
    if (request.query.download !== undefined) return archiveResponse(scope, type, name, version);
    if (!entry || entry.root.entries === null) return failure(500, INTERNAL, scope.headers);

    const files = listing(entry, entry.root.entries, false);

    return json(200, { name, version, current: `${name}@${version}`, deprecated, files }, scope.headers);
}

/**
 * Answers a request to the package routes from a catalog, as the 3.3.1 Express stack did after its rate limit.
 * It reads no disk, clock or log, never throws on client input, and answers HEAD as GET.
 *
 * @param request - Request whose path is raw and undecoded and whose query is already parsed; its target is only
 * echoed by the final 404
 * @param catalog - Catalog built by loadIndex
 * @returns The status, the headers the core owns and the body, a file or an archive body being left to the caller to
 * stream
 */
export function route(request: RouteRequest, catalog: Catalog): RouteResponse {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        const message = `Method '${request.method}' is not allowed, use GET or HEAD.`;
        return failure(405, message, { Allow: 'GET, HEAD, OPTIONS' });
    }

    const scope: Scope = { request, catalog, headers: {}, name: '', version: null, pinned: false };
    for (const [pattern, handle] of LAYERS) {
        const match = pattern.exec(request.path);
        if (!match) continue;

        let params: string[];
        try {
            params = decode(match.slice(1));
        } catch (error) {
            // Router holds a decoding error and skips every later handler, so the headers set so far stay
            return failure(400, (error as URIError).message, scope.headers);
        }

        const response = handle(scope, params);
        if (response) return response;
    }

    return failure(404, `Route '${request.target}' does not exist.`, scope.headers);
}
