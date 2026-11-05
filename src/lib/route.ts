import type {
    Catalog,
    CatalogNode,
    CatalogProject,
    CatalogType,
    CatalogVersion,
    FileEntry,
    RouteInput,
    RouteResponse,
} from '../types/index.js';

import { archiveEntries } from './archive.js';
import { checksums } from './checksum.js';
import { deprecationHeaders } from './deprecations.js';
import { errorBody } from './errors.js';
import { contentType } from './mime.js';
import { getProject, resolveVersion, searchPackages } from './packages.js';
import { followLink, resolvePath } from './paths.js';
import { matchPath } from './router.js';

interface Scope {
    request: RouteInput;
    url: URL;
    catalog: Catalog;
    headers: Record<string, string>;
}

interface Found {
    version: CatalogVersion;
    pinned: boolean;
}

// Message of every 500, which never names a server path
export const INTERNAL = 'An unexpected error occurred.';

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
 * @param headers - Headers set before the error, such as Deprecation, Link or Allow
 * @returns The JSON response of the error body
 */
export function failure(status: number, message: string, headers: Record<string, string> = {}): RouteResponse {
    return json(status, errorBody(status, message), headers);
}

/**
 * Builds the JSON view of the version links of a project, which starts with the latest alias.
 *
 * @param type - Package type folder name (e.g. npm), inserted as is in the URLs
 * @param project - Project whose versions are linked, in ascending order
 * @returns One URL per version, keyed by version name, after the URL of the alias
 */
function versionLinks(type: string, project: CatalogProject): Record<string, string> {
    const links = [...project.versions.keys()].map((name) => [name, `/${type}/${project.name}@${name}`]);

    return Object.fromEntries([['latest', `/${type}/${project.name}@latest`], ...links]);
}

/**
 * Builds the JSON view of a type, its list link first and then its projects.
 *
 * @param type - Type whose projects are listed, in index order
 * @returns The list link and one entry per project with its list link, its versions and its deprecation notice, which
 * a JSON object puts after the keys that read as integers
 */
function typeView(type: CatalogType): Record<string, unknown> {
    const projects = [...type.projects].map(([name, project]) => [
        name,
        {
            list: `/${type.name}/${name}`,
            versions: versionLinks(type.name, project),
            deprecated: project.deprecated,
        },
    ]);

    return Object.fromEntries([['list', `/${type.name}`], ...projects]);
}

/**
 * Builds the download links of every version of a project.
 *
 * @param type - Package type folder name (e.g. npm), inserted as is in the URLs
 * @param project - Project whose deprecation notice and versions are read
 * @returns The deprecation notice, the latest archive URL and one URL per version
 */
function downloadLinks(type: string, project: CatalogProject): Record<string, unknown> {
    const versions = [...project.versions.keys()].map((name) => [name, `/download/${type}/${project.name}@${name}`]);

    return {
        deprecated: project.deprecated,
        latest: `/download/${type}/${project.name}`,
        versions: Object.fromEntries(versions),
    };
}

/**
 * Builds the download links of every project of a type.
 *
 * @param type - Type whose projects are linked
 * @returns The links of each project by name, in index order
 */
function projectDownloads(type: CatalogType): Record<string, unknown> {
    return Object.fromEntries([...type.projects].map(([name, project]) => [name, downloadLinks(type.name, project)]));
}

/**
 * Lists the entries of a folder of a version, with their size.
 * A link shows as its target while the target stays inside the version, other links are left out since the file
 * route refuses them.
 *
 * @param version - Version holding the folder, whose nodes resolve the link targets
 * @param entries - Entries of the folder, in byte order
 * @returns Entries with a trailing slash on folder names and their size in bytes, cumulative for a folder
 */
function listing(version: CatalogVersion, entries: CatalogNode[]): FileEntry[] {
    return entries.flatMap((node) => {
        const target = node.kind === 'link' ? followLink(version, node) : node;
        if (!target) return [];
        if (target.kind === 'file') return { name: node.name, size: target.size, directory: false };

        return { name: `${node.name}/`, size: target.size, directory: true };
    });
}

/**
 * Picks the version that a path asks for in a project.
 * An exact version is pinned, so its files are immutable; latest and partial versions resolve to their newest match.
 *
 * @param project - Project whose versions are searched
 * @param asked - Exact, partial or latest version, as the path wrote it after the last '@'
 * @returns The version and whether it was asked exactly, or undefined when none matches
 */
function pickVersion(project: CatalogProject, asked: string): Found | undefined {
    if (asked === 'latest') return { version: project.latest, pinned: false };

    const exact = project.versions.get(asked);
    if (exact) return { version: exact, pinned: true };

    const match = resolveVersion(asked, project);

    return match && { version: match, pinned: false };
}

/**
 * Answers a download with the archive of a version, the caller streaming its entries after the headers.
 *
 * @param scope - Request state, its headers (Deprecation and Link) kept before the archive ones
 * @param version - Version to archive, whose project name starts the archive file name
 * @returns A 200 without Content-Length, ETag or Cache-Control, its entries ready to stream
 */
function archiveResponse(scope: Scope, version: CatalogVersion): RouteResponse {
    const { type, project, name } = version;

    return {
        status: 200,
        headers: {
            ...scope.headers,
            'Content-Type': 'application/gzip',
            'Content-Disposition': `attachment; filename="${project}-${name}.tar.gz"`,
        },
        body: { kind: 'archive', key: `${type}/${project}/${name}`, entries: archiveEntries(version) },
    };
}

/**
 * Answers /search with the projects whose name holds the query, then every project of the type it names.
 *
 * @param scope - Request state, its q query parameter trimmed, a repeated q counting as missing
 * @returns 200 with the query, the count and the results, or 400 when q is missing, repeated or blank
 */
function searchRoute(scope: Scope): RouteResponse {
    const values = scope.url.searchParams.getAll('q');
    const query = values.length === 1 ? values[0].trim() : '';
    if (query.length === 0) return failure(400, 'Missing required query parameter: q');

    const results = searchPackages(scope.catalog, query);

    return json(200, { query, count: results.length, results });
}

/**
 * Answers /download with the archive links of every project of every type.
 *
 * @param scope - Request state, whose types are listed in index order
 * @returns 200 with the message and the links by type and project
 */
function downloadsRoute(scope: Scope): RouteResponse {
    const types = [...scope.catalog.types].map(([name, type]) => [name, projectDownloads(type)]);

    return json(200, {
        message: 'Available packages for download (.tar.gz).',
        downloads: Object.fromEntries(types),
    });
}

/**
 * Answers /download/{type} with the archive links of every project of a type.
 *
 * @param scope - Request state, whose types are searched by exact name
 * @param type - Decoded type, which may name no type
 * @returns 200 with the message and the links by project, or 404 when the type does not exist
 */
function typeDownloadsRoute(scope: Scope, type: string): RouteResponse {
    const found = scope.catalog.types.get(type);
    if (!found) return failure(404, `Package type '${type}' does not exist.`);

    return json(200, { message: `Downloadable ${type} packages (.tar.gz).`, downloads: projectDownloads(found) });
}

/**
 * Answers /download/{type}/{project}[@{version}] with the archive of a version, the latest one by default.
 * It is the browser-friendly alias of /{type}/{project}@{version}?download, without a query string.
 *
 * @param scope - Request state, given the Deprecation and Link headers of a deprecated project
 * @param type - Decoded type, which may name no type
 * @param name - Decoded project name, without its version
 * @param asked - Exact or partial version after the last '@', null for the latest one
 * @returns The archive response, or 404 when the project or the version does not exist
 */
function archiveRoute(scope: Scope, type: string, name: string, asked: string | null): RouteResponse {
    const project = getProject(scope.catalog, type, name);
    if (!project) return failure(404, `Project '${name}' does not exist in /${type}.`);

    if (project.deprecated) Object.assign(scope.headers, deprecationHeaders(project.deprecated));

    const wanted = asked ?? 'latest';
    const found = pickVersion(project, wanted);
    if (!found) return failure(404, `Version ${wanted} does not exist in the '${name}' project.`, scope.headers);

    return archiveResponse(scope, found.version);
}

/**
 * Answers /{type}/{project}/changelog with every version of a project and its release date.
 *
 * @param scope - Request state, given the Deprecation and Link headers of a deprecated project
 * @param type - Decoded type, which exists
 * @param project - Project found by the path
 * @returns 200 with the versions in listing order and their date from the index
 */
function changelogRoute(scope: Scope, type: string, project: CatalogProject): RouteResponse {
    const changelog = [...project.versions.values()].map(({ name, date }) => ({
        version: name,
        date,
        url: `/${type}/${project.name}@${name}`,
    }));
    const headers = { ...scope.headers, 'Cache-Control': 'public, max-age=300' };
    const { deprecated } = project;

    return json(200, { name: project.name, type, deprecated, versions: changelog.length, changelog }, headers);
}

/**
 * Answers /{type}/{project} with the versions of a project.
 *
 * @param scope - Request state, given the Deprecation and Link headers of a deprecated project
 * @param type - Decoded type, which exists
 * @param project - Project found by the path
 * @returns 200 with the message, the deprecation notice and the version links, the latest alias first
 */
function versionsRoute(scope: Scope, type: string, project: CatalogProject): RouteResponse {
    const message = `Available versions for the '${project.name}' project.`;
    const { deprecated } = project;

    return json(200, { message, deprecated, versions: versionLinks(type, project) }, scope.headers);
}

/**
 * Answers /{type}/{project}@{version}/{file} with a file or the listing of a folder of the version.
 * Links are resolved inside the version only, so a link out of it reads as a missing file.
 *
 * @param scope - Request state, its If-None-Match compared with the file ETag
 * @param project - Project found by the path
 * @param found - Version that the path asks for, and whether it is pinned
 * @param file - Decoded path under the version, its segments joined with '/' and none of them empty
 * @param slash - True when the path ended with '/', which only a folder answers and which a missing file echoes
 * @returns 200 with a listing or a file body, 304 when the ETag matches, or 404 when the file is missing, is a file
 * reached with a trailing slash or is past MAX_LINKS link crossings, whatever If-None-Match says; a file has the quoted
 * SHA-256 of its bytes as its ETag and the release day of its version as its Last-Modified, on its 304 too
 */
function fileRoute(scope: Scope, project: CatalogProject, found: Found, file: string, slash: boolean): RouteResponse {
    const { version, pinned } = found;
    const { name, deprecated } = project;
    const asked = slash ? `${file}/` : file;
    const missing = `File '${asked}' does not exist in the ${version.name} version of the '${name}' project.`;

    const resolved = resolvePath(version, file);
    if (!resolved) return failure(404, missing, scope.headers);

    const { node } = resolved;
    if (slash && node.kind !== 'dir') return failure(404, missing, scope.headers);
    if (node.kind === 'dir') {
        const files = listing(version, node.entries);

        return json(200, { name, version: version.name, path: file, deprecated, files }, scope.headers);
    }

    // Only an exact version is immutable: latest and partial versions move to the next release
    const cache = pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
    const etag = `"${node.sha256}"`;
    const headers: Record<string, string> = { ...scope.headers, 'Cache-Control': cache, ETag: etag };

    // Every file of a version shares the release day, 00:00:00 GMT
    headers['Last-Modified'] = new Date(version.released).toUTCString();

    if (scope.request.headers.get('if-none-match') === etag) return { status: 304, headers, body: { kind: 'empty' } };

    headers['Content-Type'] = contentType(file);
    headers['X-Content-Type-Options'] = 'nosniff';

    return {
        status: 200,
        headers,
        body: {
            kind: 'file',
            path: `${version.type}/${version.project}/${version.name}/${resolved.path}`,
            size: node.size,
            missing,
            precondition: `Precondition failed for file '${file}'.`,
            range: `Range not satisfiable for file '${file}'.`,
        },
    };
}

/**
 * Answers / with the routes to start from and every package.
 *
 * @param scope - Request state, whose types are listed whole
 * @returns 200 with the message, the route links and the packages by type
 */
function rootRoute(scope: Scope): RouteResponse {
    const types = [...scope.catalog.types].map(([name, type]) => [name, typeView(type)]);

    return json(200, {
        message: 'Use the following routes to access the projects and their versions.',
        manifest: '/manifest',
        health: '/health',
        search: '/search?q=',
        download: '/download',
        packages: Object.fromEntries(types),
    });
}

/**
 * Answers /{type} with the projects of a type.
 *
 * @param type - Type found by the path, whose first character is upper-cased in the message
 * @returns 200 with the message and the type view, its 'list' key included
 */
function typeRoute(type: CatalogType): RouteResponse {
    return json(200, {
        message: `${type.name[0].toUpperCase() + type.name.slice(1)} projects.`,
        projects: typeView(type),
    });
}

/**
 * Answers /{type}/{project}@{version} with the files, the checksums or the archive of a version.
 * ?checksums wins over ?download in any order, and none of these answers sets Cache-Control.
 *
 * @param scope - Request state, its checksums and download query parameters read for presence
 * @param project - Project found by the path
 * @param version - Version that the path asks for
 * @returns 200 with the listing, the checksums or an archive body
 */
function versionRoute(scope: Scope, project: CatalogProject, version: CatalogVersion): RouteResponse {
    const { name, deprecated } = project;
    if (scope.url.searchParams.has('checksums')) {
        const sums = Object.fromEntries(checksums(version));

        return json(
            200,
            { name, version: version.name, deprecated, algorithm: 'sha256', checksums: sums },
            scope.headers,
        );
    }
    if (scope.url.searchParams.has('download')) return archiveResponse(scope, version);

    const files = listing(version, version.root.entries);

    return json(
        200,
        { name, version: version.name, current: `${name}@${version.name}`, deprecated, files },
        scope.headers,
    );
}

/**
 * Answers a path that no route has the shape of, or a path below a project that holds no such route.
 *
 * @param scope - Request state, its URL echoed by path only and its headers kept, such as the Deprecation of a project
 * @returns 404 naming the encoded pathname, never the query
 */
function unknownRoute(scope: Scope): RouteResponse {
    return failure(404, `Route '${scope.url.pathname}' does not exist.`, scope.headers);
}

/**
 * Parses the absolute URL of a request, which the router reads as a hierarchical path.
 *
 * @param text - URL as the adapter built it
 * @returns The URL, or null when it does not parse or its scheme is neither http nor https, so that a URL with no
 * path such as data: or mailto: is never routed
 */
function parseUrl(text: string): URL | null {
    try {
        const url = new URL(text);

        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

/**
 * Answers a request to the package routes from a catalog, once the adapter has applied its rate limit.
 * It reads no disk, clock or log, never throws on client input, and answers HEAD as GET.
 *
 * @param request - Request to answer, its method upper case and its url absolute with an http or https scheme, of which
 * only the path and the query are read
 * @param catalog - Catalog built by loadIndex
 * @returns The status, the headers the core owns and the body, a file or an archive body being left to the caller to
 * stream
 */
export function route(request: RouteInput, catalog: Catalog): RouteResponse {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        const message = `Method '${request.method}' is not allowed, use GET or HEAD.`;
        return failure(405, message, { Allow: 'GET, HEAD, OPTIONS' });
    }

    const url = parseUrl(request.url);
    if (!url) return failure(400, 'The request URL is not valid.');

    const scope: Scope = { request, url, catalog, headers: {} };
    const match = matchPath(url.pathname);

    switch (match.id) {
        case 'encoding':
            return failure(400, 'The path holds an invalid percent-encoding.');
        case 'unknown':
            return unknownRoute(scope);
        case 'root':
            return rootRoute(scope);
        case 'search':
            return searchRoute(scope);
        case 'downloads':
            return downloadsRoute(scope);
        case 'typeDownloads':
            return typeDownloadsRoute(scope, match.type);
        case 'archive':
            return archiveRoute(scope, match.type, match.name, match.version);
    }

    const type = catalog.types.get(match.type);
    if (!type) return failure(404, `Package type '${match.type}' does not exist.`);
    if (match.id === 'type') return typeRoute(type);

    const project = type.projects.get(match.name);
    if (!project) return failure(404, `Project '${match.name}' does not exist in /${match.type}.`);

    if (project.deprecated) Object.assign(scope.headers, deprecationHeaders(project.deprecated));

    switch (match.id) {
        case 'beneath':
            return unknownRoute(scope);
        case 'changelog':
            return changelogRoute(scope, match.type, project);
        case 'versions':
            return versionsRoute(scope, match.type, project);
    }

    const found = pickVersion(project, match.version);
    if (!found)
        return failure(404, `Version ${match.version} does not exist in the '${match.name}' project.`, scope.headers);

    return match.id === 'file'
        ? fileRoute(scope, project, found, match.path, match.slash)
        : versionRoute(scope, project, found.version);
}
