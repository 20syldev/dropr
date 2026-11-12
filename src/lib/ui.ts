import type {
    Catalog,
    CatalogProject,
    CatalogVersion,
    ErrorLogger,
    Match,
    ReadFile,
    RouteInput,
    SearchResult,
} from '../types/index.js';

import { GUIDES } from './guides.js';
import { renderMarkdown } from './markdown.js';
import { docsPage, errorPage, homePage, projectPage, searchPage, typePage, versionPage } from './pages.js';
import type { SiteInfo } from './pages.js';
import { searchPackages } from './packages.js';
import { deprecationHeaders } from './deprecations.js';
import { encodeSegment } from './html.js';
import { resolvePath } from './paths.js';
import { listing, parseUrl, pickVersion } from './route.js';
import { matchPath } from './router.js';

/**
 * What the pages are made from.
 */
export interface UiOptions {
    catalog: Catalog;
    site: SiteInfo;
    read: ReadFile;
    logger: ErrorLogger;
}

/**
 * A page ready to send.
 */
export interface UiPage {
    status: number;
    headers: Record<string, string>;
    html: string;
}

/**
 * What uiPage decides about a request: the page when the reader asked for one, and whether the answer to this path
 * depends on the Accept header, so that the caller marks it with Vary.
 */
export interface UiResult {
    page: UiPage | null;
    vary: boolean;
}

// Ids of the routes whose answer is a page for a browser and JSON for any other client
const NEGOTIATED: Match['id'][] = [
    'root',
    'search',
    'type',
    'versions',
    'version',
    'file',
    'beneath',
    'unknown',
    'encoding',
];

// Name of a README that is shown on a page
const README = /^readme(?:\.md|\.markdown)$/i;

// Largest README that is read, in bytes
const README_LIMIT = 262144;

// A page runs no script and loads nothing but its own style, the images of a README and a link to the search
const SECURITY: Record<string, string> = {
    'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
};

const encoder = new TextEncoder();

/**
 * Reads the quality that an Accept header gives to a media type.
 *
 * @param ranges - Media ranges of the header, split at the commas
 * @param types - Media types that count
 * @returns The greatest quality given to one of the types by name, 0 when none is named
 */
function quality(ranges: string[], types: string[]): number {
    let best = 0;
    for (const range of ranges) {
        const [type, ...parameters] = range.split(';').map((part) => part.trim().toLowerCase());
        if (!types.includes(type)) continue;

        const given = parameters.find((parameter) => parameter.startsWith('q='));
        const value = given === undefined ? 1 : Number(given.slice(2));
        if (Number.isFinite(value) && value > best) best = value;
    }

    return best;
}

/**
 * Tells whether a client asks for a page: it names HTML, and prefers it to JSON.
 * A wildcard does not count, so curl, fetch() and scripts keep the JSON they always got.
 *
 * @param accept - Value of the Accept header, null when absent
 * @returns true when text/html or application/xhtml+xml is named with a quality above 0 and above the one of JSON
 */
export function prefersHtml(accept: string | null): boolean {
    if (accept === null) return false;

    const ranges = accept.split(',');
    const html = quality(ranges, ['text/html', 'application/xhtml+xml']);

    return html > 0 && html > quality(ranges, ['application/json']);
}

/**
 * Makes the page of a document.
 *
 * @param status - HTTP status
 * @param html - The document
 * @param extra - Headers set before the others, such as the Deprecation and Link of a deprecated project
 * @param vary - Whether the answer to this path depends on Accept, which is false for a path that has no JSON form
 * @returns The page with the headers of a document: type, length, security, and a short cache for a 200
 */
function pageOf(status: number, html: string, extra: Record<string, string> = {}, vary = true): UiPage {
    const headers: Record<string, string> = {
        ...extra,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(encoder.encode(html).length),
        ...SECURITY,
        ...(vary ? { Vary: 'Accept' } : {}),
    };
    if (status === 200) headers['Cache-Control'] = 'public, max-age=300';

    return { status, headers, html };
}

/**
 * Makes the page of an error.
 *
 * @param site - Name, version and base URL of the server
 * @param status - HTTP status
 * @param message - Explanation, as the JSON error says it
 * @param extra - Headers set before the others, as the JSON error sets them
 * @returns The page
 */
function failed(site: SiteInfo, status: number, message: string, extra: Record<string, string> = {}): UiPage {
    return pageOf(status, errorPage(site, status, message), extra);
}

/**
 * Reads the text of a stream, up to a limit.
 *
 * @param stream - Bytes to read
 * @param limit - Most bytes to accept
 * @returns The text, decoded as UTF-8
 * @throws Error when the stream holds more than the limit
 */
async function readText(stream: ReadableStream<Uint8Array>, limit: number): Promise<string> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        total += value.length;
        if (total > limit) {
            await reader.cancel();
            throw new Error(`README is larger than ${limit} bytes`);
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }

    return new TextDecoder().decode(bytes);
}

/**
 * Reads and renders the README of a version.
 * It is the file called README.md or README.markdown at the root of the version, if it is a file of the index.
 *
 * @param version - Version whose root is looked at
 * @param options - Read port and logger
 * @returns The HTML, with relative addresses resolved against the version, or null when there is no README, it is too
 * large or it cannot be read, which is logged
 */
async function readmeOf(version: CatalogVersion, options: UiOptions): Promise<string | null> {
    const entry = version.root.entries.find((node) => README.test(node.name));
    const resolved = entry && resolvePath(version, entry.name);
    if (!resolved || resolved.node.kind !== 'file' || resolved.node.size > README_LIMIT) return null;

    const path = `${version.type}/${version.project}/${version.name}/${resolved.path}`;
    try {
        const text = await readText(await options.read(path), README_LIMIT);
        const base = `/${encodeSegment(version.type)}/${encodeSegment(version.project)}@${encodeSegment(version.name)}/`;

        return renderMarkdown(text, { base, offset: 2 });
    } catch (error) {
        options.logger.error(`README error on ${path}:`, (error as Error).message);

        return null;
    }
}

/**
 * Finds the latest version of a project that a search found.
 *
 * @param catalog - Catalog the result comes from
 * @param result - Result of a search
 * @returns The name of the latest version, which is not always the highest, or '' when the project is gone
 */
function latestOf(catalog: Catalog, result: SearchResult): string {
    return catalog.types.get(result.type)?.projects.get(result.name)?.latest.name ?? '';
}

/**
 * Finds the page of a path that names a type, a project or a version.
 *
 * @param match - What the router made of the path, of type, versions, version or file
 * @param url - Request URL, whose query tells a page from an archive or a list of checksums
 * @param options - Catalog, site texts, read port and logger
 * @returns The page, or null when the path is a file or a missing file, or asks for checksums or an archive, which
 * the JSON routes answer
 */
async function packagePage(
    match: Extract<Match, { id: 'type' | 'versions' | 'version' | 'file' | 'beneath' }>,
    url: URL,
    options: UiOptions,
): Promise<UiPage | null> {
    const { catalog, site } = options;

    const type = catalog.types.get(match.type);
    if (!type) return failed(site, 404, `Package type '${match.type}' does not exist.`);
    if (match.id === 'type') return pageOf(200, typePage(site, type));

    const project: CatalogProject | undefined = type.projects.get(match.name);
    if (!project) return failed(site, 404, `Project '${match.name}' does not exist in /${match.type}.`);

    const notice = project.deprecated ? deprecationHeaders(project.deprecated) : {};
    if (match.id === 'beneath') return failed(site, 404, `Route '${url.pathname}' does not exist.`, notice);
    if (match.id === 'versions') {
        return pageOf(200, projectPage(site, match.type, project, await readmeOf(project.latest, options)), notice);
    }

    const found = pickVersion(project, match.version);
    if (!found) {
        return failed(site, 404, `Version ${match.version} does not exist in the '${match.name}' project.`, notice);
    }

    const { version } = found;
    if (match.id === 'version') {
        if (url.searchParams.has('checksums') || url.searchParams.has('download')) return null;

        const html = versionPage(
            site,
            project,
            version,
            '',
            listing(version, version.root.entries),
            await readmeOf(version, options),
        );

        return pageOf(200, html, notice);
    }

    const resolved = resolvePath(version, match.path);
    if (!resolved || resolved.node.kind !== 'dir') return null;

    const folder = versionPage(site, project, version, match.path, listing(version, resolved.node.entries), null);

    return pageOf(200, folder, notice);
}

/**
 * Tells whether a file path is a path that has a page: a folder, or a path below a type, project or version that does
 * not exist, which gets the page of its error. A file, and a file that is missing, are left to the file route, so that
 * the files keep one form and one cache entry.
 *
 * @param match - A file match of the router
 * @param catalog - Catalog the path is looked up in
 * @returns true when the path has a page
 */
function hasPage(match: Extract<Match, { id: 'file' }>, catalog: Catalog): boolean {
    const project = catalog.types.get(match.type)?.projects.get(match.name);
    const found = project && pickVersion(project, match.version);
    if (!found) return true;

    return resolvePath(found.version, match.path)?.node.kind === 'dir';
}

/**
 * Answers a path of the docs of dropr.
 * A page of the docs has no JSON form, so it is sent to every client and does not vary. When the docs are off or the
 * page does not exist, the path is a route that does not exist, which answers as every such route does.
 *
 * @param match - A docs match of the router
 * @param request - Request to answer, a GET or a HEAD
 * @param url - Request URL
 * @param options - Catalog, site texts, read port and logger
 * @returns The page of the docs, the error page for a browser, or nothing for a client that wants JSON
 */
function docsResult(
    match: Extract<Match, { id: 'docs' }>,
    request: RouteInput,
    url: URL,
    options: UiOptions,
): UiResult {
    const { site } = options;
    const guide = site.docs
        ? GUIDES.find((entry) => (match.page === null ? entry === GUIDES[0] : entry.slug === match.page))
        : undefined;

    if (guide) {
        const html = docsPage(site, GUIDES, guide.slug, renderMarkdown(guide.markdown, { base: '/-/docs/' }));

        return { page: pageOf(200, html, {}, false), vary: false };
    }
    if (!prefersHtml(request.headers.get('accept'))) return { page: null, vary: true };

    return { page: failed(site, 404, `Route '${url.pathname}' does not exist.`), vary: true };
}

/**
 * Answers a request with a page when the client asks for one and the path has one.
 * The pages sit on the paths of the JSON listings, so a path that has both says so with Vary: Accept, whoever asks.
 *
 * @param request - Request to answer, a GET or a HEAD
 * @param options - Catalog, site texts, read port and logger
 * @returns The page when the client prefers HTML and the path has a page, a miss of the router and a bad encoding
 * included; vary is true for every path that has both forms
 */
export async function uiResult(request: RouteInput, options: UiOptions): Promise<UiResult> {
    const none: UiResult = { page: null, vary: false };
    if (request.method !== 'GET' && request.method !== 'HEAD') return none;

    const url = parseUrl(request.url);
    if (url === null) return none;

    const match = matchPath(url.pathname);
    if (match.id === 'docs') return docsResult(match, request, url, options);
    if (!NEGOTIATED.includes(match.id)) return none;
    if (match.id === 'file' && !hasPage(match, options.catalog)) return none;
    if (!prefersHtml(request.headers.get('accept'))) return { page: null, vary: true };

    const { catalog, site } = options;
    let page: UiPage | null;
    switch (match.id) {
        case 'root':
            page = pageOf(200, homePage(site, [...catalog.types.values()]));
            break;
        case 'search': {
            const values = url.searchParams.getAll('q');
            const query = values.length === 1 ? values[0].trim() : '';
            const found = searchPackages(catalog, query);

            page = pageOf(
                200,
                searchPage(site, query, found, (result) => latestOf(catalog, result)),
            );
            break;
        }
        case 'encoding':
            page = failed(site, 400, 'The path holds an invalid percent-encoding.');
            break;
        case 'type':
        case 'versions':
        case 'version':
        case 'file':
        case 'beneath':
            page = await packagePage(match, url, options);
            break;
        default:
            page = failed(site, 404, `Route '${url.pathname}' does not exist.`);
    }

    return { page, vary: true };
}
