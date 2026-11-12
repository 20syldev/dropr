import type {
    CatalogProject,
    CatalogType,
    CatalogVersion,
    Deprecation,
    FileEntry,
    SearchResult,
} from '../types/index.js';

import { encodeSegment, escapeHtml } from './html.js';
import { isRelease } from './semver.js';
import { STYLE } from './style.js';

/**
 * What the pages say about the server that serves them.
 */
export interface SiteInfo {
    name: string;
    version: string;
    baseUrl: string;
}

// Projects of a type that the front page lists before it sends the reader to the page of the type
const FRONT_LIMIT = 30;

/**
 * Encodes the segments of a path of a version so that a name with a mark in it stays one address.
 *
 * @param path - Path under a version, its segments joined with '/'
 * @returns The path with each segment percent-encoded
 */
function encodePath(path: string): string {
    return path.split('/').map(encodeSegment).join('/');
}

/**
 * Writes a size the way a listing does.
 *
 * @param bytes - Size in bytes
 * @returns The size with a unit from B to GB, one decimal from KB up
 */
function formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }

    return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Writes the status mark that follows the name of a project or a version.
 *
 * @param kind - dep for a deprecated project, pre for a pre-release, latest for the version that the project resolves to
 * @param text - Word of the mark
 * @returns The span element, preceded by a space so that the name and the mark read and copy as two words
 */
function mark(kind: 'dep' | 'pre' | 'latest', text: string): string {
    return ` <span class="mark ${kind}">${text}</span>`;
}

/**
 * Writes a whole page around some content.
 *
 * @param site - Name and version of the server
 * @param title - Title of the page, which the name of the server follows
 * @param body - HTML of the main part, already escaped
 * @param query - Text of the search box
 * @returns The document
 */
function layout(site: SiteInfo, title: string, body: string, query = ''): string {
    const name = escapeHtml(site.name);
    const heading = title === '' ? name : `${escapeHtml(title)} - ${name}`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="top">
<a class="brand" href="/">${name}</a>
<form action="/search" method="get" role="search">
<input type="search" name="q" value="${escapeHtml(query)}" placeholder="Search packages" aria-label="Search packages" required>
<button type="submit">Search</button>
</form>
</header>
<main>
${body}</main>
<footer>Powered by dropr ${escapeHtml(site.version)}</footer>
</body>
</html>
`;
}

/**
 * Writes the trail of links above the title of a page.
 *
 * @param steps - Label and address of each step but the last, which is the page itself
 * @param last - Label of the page itself
 * @returns The nav element
 */
function crumbs(steps: [string, string][], last: string): string {
    const links = steps.map(([label, href]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);

    return `<nav class="crumbs">${[...links, escapeHtml(last)].join(' / ')}</nav>\n`;
}

/**
 * Writes an address as a link when it can be followed, as text otherwise.
 *
 * @param address - Address a deprecation names as successor
 * @returns A link for a path of this server or an http(s) address, the escaped text for anything else
 */
function linkOrText(address: string): string {
    const text = escapeHtml(address);

    return /^(\/(?![/\\])|https?:\/\/)\S+$/i.test(address) ? `<a href="${text}">${text}</a>` : text;
}

/**
 * Writes the notice of a deprecated project.
 *
 * @param deprecation - Notice from the index
 * @returns The notice element
 */
function notice(deprecation: Deprecation): string {
    const { date, successor } = deprecation;
    const message = deprecation.message.trim();
    const said = message === '' ? '.' : `: ${/[.!?]$/.test(message) ? message : `${message}.`}`;

    return `<p class="notice"><strong>Deprecated</strong> since ${escapeHtml(date)}${escapeHtml(said)} Use ${linkOrText(successor)} instead.</p>\n`;
}

/**
 * Writes the list of the projects of a type as a book-style index.
 *
 * @param type - Type whose projects are listed
 * @param limit - Most projects to list, the others being left to the page of the type
 * @returns The list element
 */
function projectIndex(type: CatalogType, limit: number): string {
    const rows = [...type.projects.values()].slice(0, limit).map((project) => {
        const flag = project.deprecated ? mark('dep', 'Deprecated') : '';
        const link = `<a href="/${encodeSegment(type.name)}/${encodeSegment(project.name)}">${escapeHtml(project.name)}</a>`;

        return `<li>${link}${flag}<span class="dots"></span><span class="end">${escapeHtml(project.latest.name)}</span></li>\n`;
    });

    return `<ul class="index">\n${rows.join('')}</ul>\n`;
}

/**
 * Writes the table of the files of a folder of a version.
 *
 * @param base - Address of the folder, ending with a slash
 * @param entries - Entries of the folder, folders carrying a trailing slash
 * @returns The table element, or a line saying that the folder is empty
 */
function fileTable(base: string, entries: FileEntry[]): string {
    if (entries.length === 0) return '<p class="meta">This folder is empty.</p>\n';

    const sorted = [...entries].sort((a, b) => Number(b.directory) - Number(a.directory));
    const rows = sorted.map(({ name, size, directory }) => {
        const href = `${base}${encodePath(directory ? name.slice(0, -1) : name)}${directory ? '/' : ''}`;

        return `<tr><td><a href="${href}">${escapeHtml(name)}</a></td><td class="right">${formatSize(size)}</td></tr>\n`;
    });

    return `<table>\n<thead><tr><th>Name</th><th class="right">Size</th></tr></thead>\n<tbody>\n${rows.join('')}</tbody>\n</table>\n`;
}

/**
 * Writes the section that holds a rendered README.
 *
 * @param html - HTML from renderMarkdown, or null when the version has no README
 * @returns The section, empty when there is no README
 */
function readme(html: string | null): string {
    return html === null ? '' : `<section class="markdown">\n<h2>README</h2>\n${html}</section>\n`;
}

/**
 * Writes the front page: every type with its first projects.
 *
 * @param site - Name, version and base URL of the server
 * @param types - Types of the catalog, in index order
 * @returns The document
 */
export function homePage(site: SiteInfo, types: CatalogType[]): string {
    const count = types.reduce((sum, type) => sum + type.projects.size, 0);
    const sections = types.map((type) => {
        const more =
            type.projects.size > FRONT_LIMIT
                ? `<p class="meta"><a href="/${encodeSegment(type.name)}">All ${type.projects.size} projects</a></p>\n`
                : '';

        return `<section>\n<h2><a href="/${encodeSegment(type.name)}">${escapeHtml(type.name)}</a></h2>\n${projectIndex(type, FRONT_LIMIT)}${more}</section>\n`;
    });
    const lead =
        count === 0
            ? 'No packages yet.'
            : `${count} package${count === 1 ? '' : 's'} in ${types.length} type${types.length === 1 ? '' : 's'}.`;
    const links = '<a href="/manifest">Routes</a> - <a href="/health">Health</a> - <a href="/download">Archives</a>';

    return layout(
        site,
        '',
        `<h1>${escapeHtml(site.name)}</h1>\n<p class="lead">${lead}</p>\n<p class="meta">${links}</p>\n${sections.join('')}`,
    );
}

/**
 * Writes the results of a search.
 *
 * @param site - Name, version and base URL of the server
 * @param query - Text that was searched, empty when the box was empty
 * @param results - Projects found
 * @param latestOf - Name of the latest version of a result, which the other pages show too
 * @returns The document
 */
export function searchPage(
    site: SiteInfo,
    query: string,
    results: SearchResult[],
    latestOf: (result: SearchResult) => string,
): string {
    const rows = results.map((result) => {
        const flag = result.deprecated ? mark('dep', 'Deprecated') : '';
        const latest = latestOf(result);

        return `<li><a href="/${encodeSegment(result.type)}/${encodeSegment(result.name)}">${escapeHtml(result.type)}/${escapeHtml(result.name)}</a>${flag}<span class="dots"></span><span class="end">${escapeHtml(latest)}</span></li>\n`;
    });
    const lead =
        query === ''
            ? 'Type a name to search the packages.'
            : `${results.length} result${results.length === 1 ? '' : 's'} for ${escapeHtml(query)}.`;

    return layout(
        site,
        query === '' ? 'Search' : query,
        `<h1>Search</h1>\n<p class="lead">${lead}</p>\n<ul class="index">\n${rows.join('')}</ul>\n`,
        query,
    );
}

/**
 * Writes the page of a type: its projects.
 *
 * @param site - Name, version and base URL of the server
 * @param type - Type to list
 * @returns The document
 */
export function typePage(site: SiteInfo, type: CatalogType): string {
    const count = type.projects.size;
    const archives = `<a href="/download/${encodeSegment(type.name)}">Archives</a>`;
    const body = `${crumbs([['All packages', '/']], type.name)}<h1>${escapeHtml(type.name)}</h1>\n<p class="lead">${count} project${count === 1 ? '' : 's'}.</p>\n<p class="meta">${archives}</p>\n${projectIndex(type, Infinity)}`;

    return layout(site, type.name, body);
}

/**
 * Writes the page of a project: how to use it, its versions and the README of the latest one.
 *
 * @param site - Name, version and base URL of the server
 * @param type - Name of the type that holds the project
 * @param project - Project to show
 * @param html - Rendered README of the latest version, null when it has none
 * @returns The document
 */
export function projectPage(site: SiteInfo, type: string, project: CatalogProject, html: string | null): string {
    const { latest, deprecated } = project;
    const path = `/${encodeSegment(type)}/${encodeSegment(project.name)}`;
    const origin = escapeHtml(site.baseUrl);
    const rows = [...project.versions.values()].reverse().map((version) => {
        const flags = `${version === latest ? mark('latest', 'Latest') : ''}${isRelease(version.name) ? '' : mark('pre', 'Pre-release')}`;

        return `<tr><td><a href="${path}@${encodeSegment(version.name)}">${escapeHtml(version.name)}</a>${flags}</td><td>${escapeHtml(version.date)}</td></tr>\n`;
    });
    const use = `<dl>
<dt>Latest</dt><dd><a href="${path}@latest"><code>${origin}${path}@latest/</code></a></dd>
<dt>Pinned</dt><dd><a href="${path}@${encodeSegment(latest.name)}"><code>${origin}${path}@${escapeHtml(latest.name)}/</code></a></dd>
<dt>Archive</dt><dd><a href="/download${path}@${encodeSegment(latest.name)}"><code>${origin}/download${path}@${escapeHtml(latest.name)}</code></a></dd>
</dl>
`;
    const body = `${crumbs(
        [
            ['All packages', '/'],
            [type, `/${encodeSegment(type)}`],
        ],
        project.name,
    )}<h1>${escapeHtml(project.name)}${deprecated ? mark('dep', 'Deprecated') : ''}</h1>
<p class="lead">Latest version ${escapeHtml(latest.name)}, released ${escapeHtml(latest.date)}.</p>
${deprecated ? notice(deprecated) : ''}<h2>Use</h2>
${use}<h2>Versions</h2>
<table>
<thead><tr><th>Version</th><th>Released</th></tr></thead>
<tbody>
${rows.join('')}</tbody>
</table>
${readme(html)}`;

    return layout(site, `${type}/${project.name}`, body);
}

/**
 * Writes the page of a version, or of one of its folders: the files, and the README at the root.
 *
 * @param site - Name, version and base URL of the server
 * @param project - Project the version belongs to
 * @param version - Version shown, as resolved from what the address asked
 * @param folder - Path of the folder under the version, '' for the root of the version
 * @param entries - Entries of the folder
 * @param html - Rendered README of the version, null when it has none or the folder is not the root
 * @returns The document
 */
export function versionPage(
    site: SiteInfo,
    project: CatalogProject,
    version: CatalogVersion,
    folder: string,
    entries: FileEntry[],
    html: string | null,
): string {
    const { type } = version;
    const base = `/${encodeSegment(type)}/${encodeSegment(project.name)}@${encodeSegment(version.name)}`;
    const projectPath = `/${encodeSegment(type)}/${encodeSegment(project.name)}`;
    const steps: [string, string][] = [
        ['All packages', '/'],
        [type, `/${encodeSegment(type)}`],
        [project.name, projectPath],
    ];
    const parts = folder === '' ? [] : folder.split('/');
    if (parts.length > 0) steps.push([version.name, `${base}/`]);
    parts
        .slice(0, -1)
        .forEach((part, n) => steps.push([part, `${base}/${encodePath(parts.slice(0, n + 1).join('/'))}/`]));
    const trail = crumbs(steps, parts.length === 0 ? version.name : parts[parts.length - 1]);
    const actions =
        folder === ''
            ? `<p class="meta"><a href="/download/${encodeSegment(type)}/${encodeSegment(project.name)}@${encodeSegment(version.name)}">Download .tar.gz</a> - <a href="${base}?checksums">Checksums</a></p>\n`
            : '';
    const title = `${escapeHtml(project.name)}@${escapeHtml(version.name)}${folder === '' ? '' : `/${escapeHtml(folder)}`}`;
    const body = `${trail}<h1>${title}${isRelease(version.name) ? '' : mark('pre', 'Pre-release')}</h1>
<p class="lead">Released ${escapeHtml(version.date)}.</p>
${project.deprecated ? notice(project.deprecated) : ''}${actions}${fileTable(folder === '' ? `${base}/` : `${base}/${encodePath(folder)}/`, entries)}${readme(html)}`;

    return layout(site, `${project.name}@${version.name}${folder === '' ? '' : `/${folder}`}`, body);
}

/**
 * Writes the page of an error.
 *
 * @param site - Name, version and base URL of the server
 * @param status - HTTP status of the answer
 * @param message - Explanation, as the JSON error says it
 * @returns The document
 */
export function errorPage(site: SiteInfo, status: number, message: string): string {
    return layout(
        site,
        String(status),
        `<h1>${status}</h1>\n<p class="lead">${escapeHtml(message)}</p>\n<p><a href="/">Back to all packages</a></p>\n`,
    );
}
