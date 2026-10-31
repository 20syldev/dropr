import type {
    Manifest,
    ManifestConfig,
    ManifestParam,
    ManifestRoute,
    ParamSpec,
    ParamText,
    RouteSpec,
    RouteText,
} from './types/index.js';

const FIXED_BASE_URL = 'https://dropr.sylvain.sh';

// Path parameters shared by most routes
const FIXED_TYPE: ManifestParam = {
    name: 'type',
    in: 'path',
    required: true,
    description: 'Type de paquet : npm, bash ou config.',
    example: 'npm',
};

const FIXED_PROJECT: ManifestParam = {
    name: 'projet',
    in: 'path',
    required: true,
    description: 'Nom du projet dans ce type.',
    example: 'moxon',
};

const FIXED_VERSION: ManifestParam = {
    name: 'version',
    in: 'path',
    required: false,
    description: 'Version exacte (6.1.0), partielle (6 ou 6.1) ou latest.',
    example: '6.1.0',
};

// Every route the server answers, in reading order; notes put code such as a query string or field name in backticks
const FIXED_ROUTES: ManifestRoute[] = [
    {
        id: 'file',
        group: 'files',
        method: 'GET',
        path: '/{type}/{projet}@{version}/{fichier}',
        title: 'Fichier',
        summary: 'Sert un fichier d’une version, avec son type MIME, ou liste un dossier en JSON.',
        params: [
            FIXED_TYPE,
            FIXED_PROJECT,
            { ...FIXED_VERSION, required: true },
            {
                name: 'fichier',
                in: 'path',
                required: true,
                description: 'Chemin du fichier dans la version.',
                example: 'dist/app.js',
            },
        ],
        example: '/npm/moxon@6.1.0/package.json',
        returns: 'file',
        notes: ['Un chemin qui sort du dossier de la version renvoie 404.'],
    },
    {
        id: 'version',
        group: 'files',
        method: 'GET',
        path: '/{type}/{projet}@{version}',
        title: 'Version',
        summary: 'Liste les fichiers d’une version, avec leur taille.',
        params: [FIXED_TYPE, FIXED_PROJECT, { ...FIXED_VERSION, required: true }],
        example: '/npm/moxon@latest',
        returns: 'json',
        notes: ['Ajoutez `?checksums` pour obtenir les SHA256, ou `?download` pour l’archive `.tar.gz`.'],
    },
    {
        id: 'checksums',
        group: 'files',
        method: 'GET',
        path: '/{type}/{projet}@{version}?checksums',
        title: 'Checksums',
        summary: 'Donne le SHA256 de chaque fichier d’une version.',
        params: [FIXED_TYPE, FIXED_PROJECT, { ...FIXED_VERSION, required: true }],
        example: '/npm/moxon@6.1.0?checksums',
        returns: 'json',
        notes: [],
    },
    {
        id: 'download',
        group: 'downloads',
        method: 'GET',
        path: '/download/{type}/{projet}@{version}',
        title: 'Archive',
        summary: 'Télécharge une version entière en .tar.gz, en pièce jointe.',
        params: [FIXED_TYPE, FIXED_PROJECT, FIXED_VERSION],
        example: '/download/bash/gft@1.0.6',
        returns: 'archive',
        notes: ['Sans version, sert la version `latest`.', 'Équivaut à `/{type}/{projet}@{version}?download`.'],
    },
    {
        id: 'downloads',
        group: 'downloads',
        method: 'GET',
        path: '/download/{type}',
        title: 'Archives disponibles',
        summary: 'Liste les archives téléchargeables, pour tous les types ou pour un seul.',
        params: [{ ...FIXED_TYPE, required: false }],
        example: '/download/npm',
        returns: 'json',
        notes: [],
    },
    {
        id: 'project',
        group: 'packages',
        method: 'GET',
        path: '/{type}/{projet}',
        title: 'Projet',
        summary: 'Liste les versions d’un projet, avec latest.',
        params: [FIXED_TYPE, FIXED_PROJECT],
        example: '/npm/moxon',
        returns: 'json',
        notes: ['Un projet déprécié porte un champ `deprecated`.'],
    },
    {
        id: 'changelog',
        group: 'packages',
        method: 'GET',
        path: '/{type}/{projet}/changelog',
        title: 'Changelog',
        summary: 'Donne l’historique des versions avec leur date de publication.',
        params: [FIXED_TYPE, FIXED_PROJECT],
        example: '/bash/gft/changelog',
        returns: 'json',
        notes: [],
    },
    {
        id: 'type',
        group: 'packages',
        method: 'GET',
        path: '/{type}',
        title: 'Type',
        summary: 'Liste les projets d’un type.',
        params: [FIXED_TYPE],
        example: '/bash',
        returns: 'json',
        notes: [],
    },
    {
        id: 'search',
        group: 'discovery',
        method: 'GET',
        path: '/search',
        title: 'Recherche',
        summary: 'Cherche un projet par son nom, ou liste un type entier.',
        params: [
            {
                name: 'q',
                in: 'query',
                required: true,
                description: 'Texte cherché dans les noms, ou un type exact.',
                example: 'mox',
            },
        ],
        example: '/search?q=mox',
        returns: 'json',
        notes: ['Les correspondances sur le nom passent avant celles sur le type.'],
    },
    {
        id: 'index',
        group: 'discovery',
        method: 'GET',
        path: '/',
        title: 'Index',
        summary: 'Donne tous les types, projets et versions en JSON.',
        params: [],
        example: '/',
        returns: 'json',
        notes: [],
    },
    {
        id: 'manifest',
        group: 'server',
        method: 'GET',
        path: '/manifest',
        title: 'Manifest',
        summary: 'Décrit toutes les routes du serveur.',
        params: [],
        example: '/manifest',
        returns: 'json',
        notes: [],
    },
    {
        id: 'health',
        group: 'server',
        method: 'GET',
        path: '/health',
        title: 'Santé',
        summary: 'Donne l’état du serveur, sa version, sa durée de fonctionnement et le nombre de paquets.',
        params: [],
        example: '/health',
        returns: 'json',
        notes: [],
    },
];

/**
 * Builds the manifest of every route the server answers, served by the /manifest route.
 *
 * @param version - Version of dropr, read from the root package.json
 * @returns The manifest with the base URL and the routes in reading order
 */
export function getManifest(version: string): Manifest {
    return { name: 'dropr', version, baseUrl: FIXED_BASE_URL, routes: FIXED_ROUTES };
}

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
