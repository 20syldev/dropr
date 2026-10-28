import type { Manifest, ManifestParam, ManifestRoute } from './types/index.js';

const BASE_URL = 'https://dropr.sylvain.sh';

// Path parameters shared by most routes
const TYPE: ManifestParam = {
    name: 'type',
    in: 'path',
    required: true,
    description: 'Type de paquet : npm, bash ou config.',
    example: 'npm',
};

const PROJECT: ManifestParam = {
    name: 'projet',
    in: 'path',
    required: true,
    description: 'Nom du projet dans ce type.',
    example: 'moxon',
};

const VERSION: ManifestParam = {
    name: 'version',
    in: 'path',
    required: false,
    description: 'Version exacte (6.1.0), partielle (6 ou 6.1) ou latest.',
    example: '6.1.0',
};

// Every route the server answers, in reading order; notes put code such as a query string or field name in backticks
const ROUTES: ManifestRoute[] = [
    {
        id: 'file',
        group: 'files',
        method: 'GET',
        path: '/{type}/{projet}@{version}/{fichier}',
        title: 'Fichier',
        summary: 'Sert un fichier d’une version, avec son type MIME, ou liste un dossier en JSON.',
        params: [
            TYPE,
            PROJECT,
            { ...VERSION, required: true },
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
        params: [TYPE, PROJECT, { ...VERSION, required: true }],
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
        params: [TYPE, PROJECT, { ...VERSION, required: true }],
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
        params: [TYPE, PROJECT, VERSION],
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
        params: [{ ...TYPE, required: false }],
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
        params: [TYPE, PROJECT],
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
        params: [TYPE, PROJECT],
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
        params: [TYPE],
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
    return { name: 'dropr', version, baseUrl: BASE_URL, routes: ROUTES };
}
