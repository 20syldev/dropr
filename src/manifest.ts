import type {
    Manifest,
    ManifestConfig,
    ManifestRoute,
    ParamSpec,
    ParamText,
    RouteSpec,
    RouteText,
} from './types/index.js';

const TYPE: ParamSpec = { key: 'type', in: 'path', required: true };
const PROJECT: ParamSpec = { key: 'project', in: 'path', required: true };
const VERSION: ParamSpec = { key: 'version', in: 'path', required: false };
const FILE: ParamSpec = { key: 'file', in: 'path', required: true };
const QUERY: ParamSpec = { key: 'q', in: 'query', required: true };

// Every route the server answers, in reading order; path tokens are the keys of the params
export const ROUTES: RouteSpec[] = [
    {
        id: 'file',
        group: 'files',
        method: 'GET',
        path: '/{type}/{project}@{version}/{file}',
        params: [TYPE, PROJECT, { ...VERSION, required: true }, FILE],
        returns: 'file',
    },
    {
        id: 'version',
        group: 'files',
        method: 'GET',
        path: '/{type}/{project}@{version}',
        params: [TYPE, PROJECT, { ...VERSION, required: true }],
        returns: 'json',
    },
    {
        id: 'checksums',
        group: 'files',
        method: 'GET',
        path: '/{type}/{project}@{version}?checksums',
        params: [TYPE, PROJECT, { ...VERSION, required: true }],
        returns: 'json',
    },
    {
        id: 'download',
        group: 'downloads',
        method: 'GET',
        path: '/download/{type}/{project}@{version}',
        params: [TYPE, PROJECT, VERSION],
        returns: 'archive',
    },
    {
        id: 'downloads',
        group: 'downloads',
        method: 'GET',
        path: '/download/{type}',
        params: [{ ...TYPE, required: false }],
        returns: 'json',
    },
    {
        id: 'project',
        group: 'packages',
        method: 'GET',
        path: '/{type}/{project}',
        params: [TYPE, PROJECT],
        returns: 'json',
    },
    {
        id: 'changelog',
        group: 'packages',
        method: 'GET',
        path: '/{type}/{project}/changelog',
        params: [TYPE, PROJECT],
        returns: 'json',
    },
    { id: 'type', group: 'packages', method: 'GET', path: '/{type}', params: [TYPE], returns: 'json' },
    { id: 'search', group: 'discovery', method: 'GET', path: '/search', params: [QUERY], returns: 'json' },
    { id: 'index', group: 'discovery', method: 'GET', path: '/', params: [], returns: 'json' },
    { id: 'manifest', group: 'server', method: 'GET', path: '/manifest', params: [], returns: 'json' },
    { id: 'health', group: 'server', method: 'GET', path: '/health', params: [], returns: 'json' },
];

// English texts of the params, filed under their key; a config overrides them field by field
const PARAMS: Record<string, ParamText> = {
    type: { name: 'type', description: 'Package type: npm, bash or config.', example: 'npm' },
    project: { name: 'project', description: 'Name of the project in this type.', example: 'moxon' },
    version: {
        name: 'version',
        description: 'Exact version (6.1.0), partial (6 or 6.1) or latest.',
        example: '6.1.0',
    },
    file: { name: 'file', description: 'Path of the file in the version.', example: 'dist/app.js' },
    q: { name: 'q', description: 'Text searched in the names, or an exact type.', example: 'mox' },
};

// English texts of the routes, filed under their id; notes put code such as a query string or field name in backticks
const TEXTS: Record<string, RouteText> = {
    file: {
        title: 'File',
        summary: 'Serves a file of a version, with its MIME type, or lists a folder as JSON.',
        example: '/npm/moxon@6.1.0/package.json',
        notes: ['A path that leaves the version folder returns 404.'],
    },
    version: {
        title: 'Version',
        summary: 'Lists the files of a version, with their size.',
        example: '/npm/moxon@latest',
        notes: ['Add `?checksums` to get the SHA256 sums, or `?download` for the `.tar.gz` archive.'],
    },
    checksums: {
        title: 'Checksums',
        summary: 'Gives the SHA256 of each file of a version.',
        example: '/npm/moxon@6.1.0?checksums',
        notes: [],
    },
    download: {
        title: 'Archive',
        summary: 'Downloads a whole version as a .tar.gz, as an attachment.',
        example: '/download/bash/gft@1.0.6',
        notes: ['Without a version, serves the `latest` version.', 'Same as `/{type}/{project}@{version}?download`.'],
    },
    downloads: {
        title: 'Available archives',
        summary: 'Lists the downloadable archives, for every type or for one.',
        example: '/download/npm',
        notes: [],
    },
    project: {
        title: 'Project',
        summary: 'Lists the versions of a project, with latest.',
        example: '/npm/moxon',
        notes: ['A deprecated project carries a `deprecated` field.'],
    },
    changelog: {
        title: 'Changelog',
        summary: 'Gives the version history with the publication date of each.',
        example: '/bash/gft/changelog',
        notes: [],
    },
    type: { title: 'Type', summary: 'Lists the projects of a type.', example: '/bash', notes: [] },
    search: {
        title: 'Search',
        summary: 'Searches a project by name, or lists a whole type.',
        example: '/search?q=mox',
        notes: ['Matches on the name come before matches on the type.'],
    },
    index: { title: 'Index', summary: 'Gives every type, project and version as JSON.', example: '/', notes: [] },
    manifest: { title: 'Manifest', summary: 'Describes every route of the server.', example: '/manifest', notes: [] },
    health: {
        title: 'Health',
        summary: 'Gives the server status, its version, its uptime and the number of packages.',
        example: '/health',
        notes: [],
    },
};

/**
 * Builds the manifest of every route the server answers, served by the /manifest route.
 * The texts are the English defaults, which the config overrides field by field; a renamed path param is renamed in the
 * paths and in every note, the ones of the config included.
 *
 * @param config - Base URL, then the names and texts of the params and the texts of the routes, by key and by id
 * @param name - Name of the server, as in /health
 * @param version - Version of dropr, read from the root package.json
 * @returns The manifest with the base URL and the routes in reading order
 */
export function buildManifest(config: ManifestConfig, name: string, version: string): Manifest {
    const named = (key: string) => config.params[key]?.name ?? PARAMS[key].name;
    const rename = (text: string) =>
        text.replace(/\{(\w+)\}/g, (token, key: string) => (Object.hasOwn(PARAMS, key) ? `{${named(key)}}` : token));
    const routes = ROUTES.map((spec): ManifestRoute => {
        const text = config.routes[spec.id];
        const base = TEXTS[spec.id];

        return {
            id: spec.id,
            group: spec.group,
            method: spec.method,
            path: rename(spec.path),
            title: text?.title ?? base.title,
            summary: text?.summary ?? base.summary,
            params: spec.params.map(({ key, in: where, required }) => ({
                name: named(key),
                in: where,
                required,
                description: config.params[key]?.description ?? PARAMS[key].description,
                example: config.params[key]?.example ?? PARAMS[key].example,
            })),
            example: text?.example ?? base.example,
            returns: spec.returns,
            notes: (text?.notes ?? base.notes).map(rename),
        };
    });

    return { name, version, baseUrl: config.baseUrl, routes };
}
