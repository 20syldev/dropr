import fs from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

import { createLogger } from '@20syldev/logger.ts';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { sendArchive } from './lib/archive.js';
import { getFilesSHA256 } from './lib/checksum.js';
import { setDeprecationHeaders } from './lib/deprecations.js';
import { sendError } from './lib/errors.js';
import { contentType } from './lib/mime.js';
import {
    countPackages,
    getPackages,
    getProject,
    hasType,
    latestVersion,
    listProjects,
    resolveVersion,
    searchPackages,
} from './lib/packages.js';
import { safeJoin, statInside } from './lib/paths.js';
import { rateLimit } from './lib/ratelimit.js';
import { getReleaseDates } from './lib/releases.js';
import { getSizes } from './lib/sizes.js';
import { getManifest } from './manifest.js';
import type { FileEntry, PackageProject } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// PACKAGES_DIR serves another tree than packages/, as the tests do with a generated one
const packagesDir = process.env.PACKAGES_DIR ? resolve(process.env.PACKAGES_DIR) : join(rootDir, 'packages');

const app = express();
const logger = createLogger({ theme: 'colored', order: 'desc' });
const pkg = JSON.parse(fs.readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const port = Number(process.env.PORT ?? 4000);
const startTime = Date.now();

const packages = getPackages(packagesDir);
const sizes = getSizes(packagesDir);
const releaseDates = getReleaseDates(packagesDir);

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
 * Lists the entries of a directory of a version, with their size.
 * A symlink shows as its target while the target stays inside the version, other symlinks are left out since the
 * file route refuses them.
 *
 * @param dirPath - Absolute directory path inside a version, joined from packagesDir so it matches the size index keys
 * @param versionDir - Version folder holding dirPath, which a symlink target must stay in to be listed
 * @returns Entries with a trailing slash on directory names and their size in bytes, cumulative for a directory and
 * null when the directory is missing from the size index, as a symlinked one is
 */
function listDirectory(dirPath: string, versionDir: string): FileEntry[] {
    return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((ent) => {
        const fullPath = join(dirPath, ent.name);
        const stat = ent.isSymbolicLink() ? statInside(versionDir, fullPath) : fs.statSync(fullPath);
        if (!stat) return [];

        return {
            name: stat.isDirectory() ? ent.name + '/' : ent.name,
            size: stat.isDirectory() ? (sizes.get(fullPath) ?? null) : stat.size,
            directory: stat.isDirectory(),
        };
    });
}

// Behind a reverse proxy, the socket address is the proxy, not the client
app.set('trust proxy', true);

app.use(
    cors({
        methods: ['GET'],
        exposedHeaders: ['Deprecation', 'Link', 'ETag', 'Content-Disposition', 'X-Content-Type-Options'],
    }),
);

// Browsers request /favicon.ico by default, so the ICO (rendered from the SVG mark) is served next to the SVG
app.use('/favicon.ico', express.static(join(rootDir, 'public', 'favicon.ico')));
app.use('/favicon.svg', express.static(join(rootDir, 'public', 'favicon.svg')));

app.use('/robots.txt', express.static(join(rootDir, 'robots.txt')));

app.use((req: Request, res: Response, next: NextFunction) => {
    res.jsonResponse = (data: unknown) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    };
    next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
        logger.request(req, res, { url: req.originalUrl, duration: `${Date.now() - start}ms` });
    });
    next();
});

app.use(rateLimit);

// Every route only reads, and the app.use() lookups below would otherwise answer or serve files for any method
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();

    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    sendError(res, 405, `Method '${req.method}' is not allowed, use GET or HEAD.`);
});

app.get('/health', (req: Request, res: Response) => {
    const uptime = (Date.now() - startTime) / 1000;
    const mem = process.memoryUsage();
    res.jsonResponse({
        name: 'dropr',
        status: 'ok',
        version: pkg.version,
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
        packages: countPackages(packages),
        memory: {
            rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        },
    });
});

app.get('/manifest', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.jsonResponse(getManifest(pkg.version));
});

app.get('/search', (req: Request, res: Response) => {
    const raw = req.query.q;
    const query = typeof raw === 'string' ? raw.trim() : '';

    if (query.length === 0) {
        return sendError(res, 400, 'Missing required query parameter: q');
    }
    const results = searchPackages(packages, query);
    res.jsonResponse({
        query,
        count: results.length,
        results,
    });
});

app.get('/download', (req: Request, res: Response) => {
    const downloads: Record<string, Record<string, unknown>> = {};
    for (const type of Object.keys(packages)) {
        downloads[type] = {};
        for (const [project, entry] of listProjects(packages, type)) {
            downloads[type][project] = downloadLinks(type, project, entry);
        }
    }
    res.jsonResponse({
        message: 'Available packages for download (.tar.gz).',
        downloads,
    });
});

app.get('/download/:type', (req: Request, res: Response) => {
    const type = req.params.type as string;

    if (!hasType(packages, type)) {
        return sendError(res, 404, `Package type '${type}' does not exist.`);
    }

    const downloads: Record<string, unknown> = {};
    for (const [project, entry] of listProjects(packages, type)) {
        downloads[project] = downloadLinks(type, project, entry);
    }
    res.jsonResponse({
        message: `Downloadable ${type} packages (.tar.gz).`,
        downloads,
    });
});

// Browser-friendly alias of /{type}/{project}@{version}?download, without a query string
app.get('/download/:type/:project', (req: Request, res: Response) => {
    const type = req.params.type as string;
    const project = req.params.project as string;
    const [name, version] = project.split('@');
    const entry = getProject(packages, type, name);

    if (!entry) {
        return sendError(res, 404, `Project '${name}' does not exist in /${type}.`);
    }

    let resolved = version || 'latest';

    if (entry.deprecated) setDeprecationHeaders(res, entry.deprecated);

    if (resolved === 'latest') {
        resolved = latestVersion(entry);
    } else if (!Object.hasOwn(entry.versions, resolved)) {
        const match = resolveVersion(resolved, entry);
        if (!match) return sendError(res, 404, `Version ${resolved} does not exist in the '${name}' project.`);
        resolved = match;
    }

    sendArchive(res, type, name, resolved, packagesDir);
});

app.use('/:type', (req: Request, res: Response, next: NextFunction) => {
    const type = req.params.type as string;

    if (!hasType(packages, type)) {
        return sendError(res, 404, `Package type '${type}' does not exist.`);
    }
    next();
});

// The changelog covers every version, so the version of /{type}/{project}@{version}/changelog is ignored
app.get('/:type/:project/changelog', (req: Request, res: Response) => {
    const type = req.params.type as string;
    const [name] = (req.params.project as string).split('@');
    const entry = getProject(packages, type, name);

    if (!entry) {
        return sendError(res, 404, `Project '${name}' does not exist in /${type}.`);
    }

    const versions = Object.keys(entry.versions).filter((v) => v !== 'latest');

    if (entry.deprecated) setDeprecationHeaders(res, entry.deprecated);

    const changelog = versions.map((version) => {
        const path = join(packagesDir, type, name, version);

        // Versions missing from .versions.json have no recorded date, the folder mtime (fetch or checkout) stands in
        const fallback = fs.statSync(path).mtime.toISOString().split('T')[0];

        return {
            version,
            date: releaseDates.get(`${type}/${name}/${version}`) ?? fallback,
            url: `/${type}/${name}@${version}`,
        };
    });

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.jsonResponse({ name, type, deprecated: entry.deprecated, versions: changelog.length, changelog });
});

app.use('/:type/:project', (req: Request, res: Response, next: NextFunction) => {
    const type = req.params.type as string;
    const project = req.params.project as string;
    const [name, version] = project.split('@');
    const entry = getProject(packages, type, name);

    req.name = name;
    req.version = version;
    req.pinned = false;

    if (!entry) {
        return sendError(res, 404, `Project '${name}' does not exist in /${type}.`);
    }

    const { deprecated } = entry;
    if (deprecated) setDeprecationHeaders(res, deprecated);

    if (!version) {
        const versions = Object.keys(entry.versions).reduce<Record<string, string>>((acc, ver) => {
            acc[ver] = `/${type}/${name}@${ver}`;
            return acc;
        }, {});

        return res.jsonResponse({
            message: `Available versions for the '${name}' project.`,
            deprecated,
            versions,
        });
    }

    if (version === 'latest') {
        req.version = latestVersion(entry);
    } else if (Object.hasOwn(entry.versions, version)) {
        req.pinned = true;
    } else {
        const match = resolveVersion(version, entry);
        if (!match) return sendError(res, 404, `Version ${version} does not exist in the '${name}' project.`);
        req.version = match;
    }
    next();
});

app.use('/:type/:project/*file', (req: Request, res: Response) => {
    const type = req.params.type as string;
    const file = ([] as string[]).concat(req.params.file as string).join('/');
    const missing = `File '${file}' does not exist in the ${req.version} version of the '${req.name}' project.`;

    // Resolved inside the version folder only, so '..' cannot reach other projects or the metadata files
    const versionDir = join(packagesDir, type, req.name, req.version);
    const location = safeJoin(versionDir, file);
    const stat = location ? statInside(versionDir, location) : null;
    if (!location || !stat) return sendError(res, 404, missing);

    if (stat.isDirectory()) {
        return res.jsonResponse({
            name: req.name,
            version: req.version,
            path: file.replace(/\/$/, ''),
            deprecated: getProject(packages, type, req.name)?.deprecated,
            files: listDirectory(location, versionDir),
        });
    }

    const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    res.setHeader('ETag', etag);

    // Only an exact version is immutable: latest and partial versions move to the next release
    res.setHeader('Cache-Control', req.pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=300');

    if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
    }

    res.setHeader('Content-Type', contentType(location));
    res.setHeader('X-Content-Type-Options', 'nosniff');

    /**
     * Relative to its version folder, so a dot folder above dropr does not hide every file. Dotfiles inside are
     * listed and checksummed, so they are served too.
     */
    res.sendFile(relative(versionDir, location), { root: versionDir, dotfiles: 'allow' }, (err) => {
        if (!err) return;
        if (res.headersSent) return void res.destroy();

        res.removeHeader('ETag');
        res.removeHeader('Cache-Control');
        res.removeHeader('Last-Modified');

        // A range or precondition the file cannot satisfy keeps its status, anything else reads as a missing file
        const { status } = err as Error & { status?: number };
        if (status === 412) return sendError(res, 412, `Precondition failed for file '${file}'.`);
        if (status === 416) return sendError(res, 416, `Range not satisfiable for file '${file}'.`);
        res.removeHeader('Content-Range');
        sendError(res, 404, missing);
    });
});

app.get('/', (req: Request, res: Response) => {
    res.jsonResponse({
        message: 'Use the following routes to access the projects and their versions.',
        manifest: '/manifest',
        health: '/health',
        search: '/search?q=',
        download: '/download',
        packages,
    });
});

app.get('/:type', (req: Request, res: Response) => {
    const type = req.params.type as string;

    res.jsonResponse({
        message: `${type[0].toUpperCase() + type.slice(1)} projects.`,
        projects: packages[type],
    });
});

app.get('/:type/:project', (req: Request, res: Response) => {
    const type = req.params.type as string;
    const name = req.name;
    const version = req.version;
    const path = join(packagesDir, type, name, version);
    const { deprecated } = getProject(packages, type, name)!;

    if (req.query.checksums !== undefined) {
        const checksums = getFilesSHA256(path);
        return res.jsonResponse({
            name,
            version,
            deprecated,
            algorithm: 'sha256',
            checksums,
        });
    }

    if (req.query.download !== undefined) {
        return sendArchive(res, type, name, version, packagesDir);
    }

    res.jsonResponse({
        name: name,
        version,
        current: name + '@' + version,
        deprecated,
        files: listDirectory(path, path),
    });
});

app.use((req: Request, res: Response) => {
    sendError(res, 404, `Route '${req.originalUrl}' does not exist.`);
});

// Also reached by errors Express raises itself (e.g. a malformed URL), which carry their own status
app.use((err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;

    if (status >= 500) console.error(err.stack);
    if (res.headersSent) return void res.destroy();

    // Client errors describe the request, server errors may leak internals
    sendError(res, status, status < 500 ? err.message : 'An unexpected error occurred.');
});

// Express 5 hands a listen failure (port taken) to this callback, so it must not report the server as running
app.listen(port, (error) => {
    if (error) throw error;

    console.log(`dropr is running on\n    - http://127.0.0.1:${port}\n    - http://localhost:${port}`);
});
