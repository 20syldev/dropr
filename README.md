# dropr

A small server for a versioned CDN: it serves bash scripts, npm packages and shared configurations from a folder of
frozen versions, with their SHA-256 checksums and a `.tar.gz` archive of each one. It reads the folder once at startup
and needs no database.

## Features

- Versioned URLs, `/<type>/<project>@<version>/<file>`: `@latest` and partial versions (`@6`, `@6.1`) resolve to the
  newest stable release, a pre-release only when no stable one matches or by its exact number (`@6.0.0-pre`).
- Real content types and `nosniff`; a strong `ETag` (the SHA-256 of the bytes), conditional requests, `Range` and `HEAD`
  as RFC 9110 says; the files of an exact version are cached for a year (`immutable`), those reached through `@latest`
  or a partial version for 5 minutes.
- JSON listings, SHA-256 checksums (`?checksums`), a reproducible `.tar.gz` archive (`?download`), a changelog with
  release dates, a search, a route manifest (`/manifest`) and a health check (`/health`).
- Optional pages for browsers (`"ui": true`): the packages by type, a project with its versions and the README of the
  latest one, a version with its files, and a search, on the same paths as the JSON listings.
- Deprecated projects (a `.deprecated.json` next to their versions) stay reachable, and every answer of the project
  carries a `Deprecation` header and a `Link` to the successor.
- Files are served from inside their version folder only: a symlink is followed only when its target stays inside.
- A rate limit per client and overall (`429` with `Retry-After`; preflights and configured assets are not counted), CORS
  open to every origin with the useful response headers exposed, and one JSON error body (`status`, `error`, `message`)
  for every error the server answers itself.
- A core that uses no Node API, importable alone as `dropr/core` (`src/lib/`, checked by `tsc -p tsconfig.core.json` and
  run in a context that has only the web globals): only the scan, the file reader and the command line depend on Node.

## Installation

```bash
npm install dropr
```

Needs Node.js 24 or later.

## Quick start

Lay the versions out as `packages/<type>/<project>/<version>/` and give each project a `.versions.json` with the release
date of every version:

```
packages/bash/hello/.versions.json  { "1.0.6": { "date": "2025-09-12" } }
packages/bash/hello/1.0.6/hello
```

```bash
npx dropr check     # reports what the server would skip, without listening
npx dropr serve     # indexes the packages and listens on port 4000
```

```bash
curl -O http://localhost:4000/bash/hello@latest/hello     # a file
curl http://localhost:4000/bash/hello@1.0.6               # the files of a version, with their size
curl "http://localhost:4000/bash/hello@1.0.6?checksums"   # their SHA-256
curl -OJ http://localhost:4000/download/bash/hello@1.0.6  # the whole version, as hello-1.0.6.tar.gz
```

## Command line

```bash
dropr serve [config] [--port 4000] [--packages ./packages] [--index file]   # index the packages and listen
dropr check [config] [--packages ./packages]                                # check the config and the packages
dropr index [config] [--packages ./packages] [--out file]                   # print the index of the packages as JSON
```

- The config is the file named, else `dropr.config.json` of the working folder, else the defaults. A named file must
  exist.
- `--port` wins over `$PORT`, which wins over `port` in the config; `--packages` wins over `packagesDir`.
- `-h`, `--help` shows the usage and `-v`, `--version` the version; both exit with `0`.
- Exit codes: `0` on success, `1` for an invalid config, an invalid `--port`, `PORT` or `--packages`, or a port that
  cannot be taken, `2` for a command line that is not understood. `check` also exits with `1` when the packages folder
  is not a folder or cannot be read, while `serve` only logs `No packages folder at ...` and starts with an empty index;
  entries `check` skips are only reported. `index` exits with `1` in those two cases too, and when `--out` cannot be
  written; `--port` belongs to `serve` and `--out` to `index`.
- `serve --index file` serves an index written by `dropr index` instead of scanning at startup. Each file of the index
  is looked at once, without being read, and the server refuses to start (exit `1`, the first problems named) when a file
  is missing, is not a regular file or has another size. A change of content that keeps the size, and a file the index
  does not list, go unnoticed: write the index again after any change of the folder.
- `index` prints the index that `serve` builds at startup, or writes it to `--out` (relative to the working folder, its
  folders made when missing, outside the packages folder). What the scan skips goes to the error output and stays out of the index, which is read back
  through `loadIndex` before it is printed, so the same tree gives the same bytes.

## Configuration

```json
{
    "name": "dropr",
    "port": 4000,
    "packagesDir": "packages",
    "clientIp": { "header": "x-real-ip" },
    "rateLimit": { "window": 10, "client": 100, "global": 1000 },
    "manifest": { "baseUrl": "https://dropr.example.com" },
    "assets": { "/robots.txt": "robots.txt" },
    "ui": false
}
```

| Key                | Default      | Description                                                                                                           |
| ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `name`             | `"dropr"`    | Shown by `/health`, `/manifest` and the startup banner                                                                |
| `port`             | `4000`       | Port to listen on, from 0 (a free port) to 65535; `--port` and `PORT` take 1 to 65535                                 |
| `packagesDir`      | `"packages"` | Folder of the packages, resolved against the folder of the config file                                                |
| `clientIp.header`  | `null`       | Header that names the client; set it only behind a proxy that rewrites it                                             |
| `rateLimit.window` | `10`         | Window in seconds                                                                                                     |
| `rateLimit.client` | `100`        | Requests per client over a sliding window                                                                             |
| `rateLimit.global` | `1000`       | Requests over a fixed window, `null` for no cap                                                                       |
| `manifest.baseUrl` | required     | Base URL of the instance, `http` or `https`, with no trailing slash; without a config file, `http://localhost:<port>` |
| `manifest.params`  | `{}`         | Overrides of the texts of `/manifest` (`manifest.routes` does the same per route)                                     |
| `assets`           | `{}`         | A URL path mapped to the file served there, read at startup                                                           |
| `ui`               | `false`      | `true` to answer a browser with pages (see Pages); the JSON stays what every other client gets                        |

Unknown keys are refused. Without `clientIp.header` the client is the socket address, and `X-Forwarded-For` is never
read. A refused request does not count against the limit, and a `429` tells in `Retry-After` how many seconds to wait.
Assets and `OPTIONS` preflights are answered before the limit and never count against it.

## Packages folder

- A version folder is named `X.Y.Z` or `X.Y.Z-tag` as semver.org writes them (no leading `v`, no leading zero, no
  `+build`). A type or project is named with letters, digits, `.`, `_` and `-`, starting with a letter, a digit or `_`;
  a type may not be `download`, `health`, `manifest` or `search` (nor the first segment of a configured asset), and a
  project may not be `list`. Any other folder is logged and left out.
- Every version needs a day in the `.versions.json` of its project: `{ "1.0.6": { "date": "YYYY-MM-DD" } }`. The day
  must be a real one between 1970-01-01 and today (UTC); a version with a missing, malformed or future day is logged and
  left out. The day becomes the `Last-Modified` of its files and the date of its archive entries.
- A project is deprecated with a `.deprecated.json`:
  `{ "date": "YYYY-MM-DD", "message": "...", "successor": "/npm/other" }`. All three fields are required, the successor
  being a URL reference with no space, `<`, `>`, `"` or non-ASCII character; a notice that fails is logged and the
  project is served without it.
- The folder is read once at startup: a version, a file, a `.versions.json` or a `.deprecated.json` changed later needs
  a restart. What the scan leaves out is logged, mostly with a line that starts with `Skipping`, and never stops the
  server. `dropr check` runs the same scan and reports every logged line as a problem, then prints
  `N problems reported above`; it still exits with `0`.

## Routes

| Route                                   | Description                                                       |
| --------------------------------------- | ----------------------------------------------------------------- |
| `/`                                     | Every type, project and version                                   |
| `/<type>`                               | Projects of a type                                                |
| `/<type>/<project>`                     | Versions of a project, `latest` included                          |
| `/<type>/<project>@<version>`           | Files of a version, with their size                               |
| `/<type>/<project>@<version>/<path>`    | A file, or the listing of a folder                                |
| `/<type>/<project>@<version>?checksums` | SHA-256 of every file of a version                                |
| `/<type>/<project>@<version>?download`  | The version as `.tar.gz`                                          |
| `/<type>/<project>/changelog`           | Versions with their release date                                  |
| `/download`, `/download/<type>`         | Archive links (latest and every version), of every type or of one |
| `/download/<type>/<project>@<version>`  | The version as `.tar.gz`, the latest one if omitted               |
| `/search?q=<term>`                      | Projects whose name contains the term, or every project of a type |
| `/manifest`                             | Description of every route                                        |
| `/health`                               | Name, status, version, uptime, package count and memory           |
| Any path listed in `assets`             | The configured file (`GET` and `HEAD`), served before the routes  |

## Pages

With `"ui": true`, a browser gets a page where every other client gets the JSON, from the same URL. The server reads the
`Accept` header: a page is sent when `text/html` (or `application/xhtml+xml`) is named with a higher quality than
`application/json`, so `curl`, `fetch()` and scripts, which send `*/*` or no `Accept`, keep the JSON they always had.
The answers of those paths carry `Vary: Accept`.

| Path                                                          | Page                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| `/`                                                           | Every type with its first projects, and a search box          |
| `/search?q=<term>`                                            | The results; an empty search is a page, not a `400`           |
| `/<type>`                                                     | The projects of the type                                      |
| `/<type>/<project>`                                           | How to use it, its versions, the deprecation and the README   |
| `/<type>/<project>@<version>`                                 | The files of the version, its archive and checksums, README   |
| `/<type>/<project>@<version>/<folder>/`                       | The files of a folder                                         |
| A missing route, type, project or version, a bad percent code | A page with the same message as the JSON error and its status |

Files are never pages: a file, a missing file, `?checksums`, `?download`, `/manifest`, `/health` and `/download` answer
as before, and a file keeps one form and one cache entry. The pages of a deprecated project carry its `Deprecation` and
`Link` headers, as its JSON does. The README is the `README.md` (or `README.markdown`) at the
root of a version, up to 256 KiB, rendered by a Markdown reader of its own that writes raw HTML as text, drops comments
and follows only `http`, `https` and `mailto` links; relative addresses resolve against the version, so a relative image
shows the file of the version. A README that cannot be read is left out and logged.

A page is one document with its style inline, no script and no font, and carries a `Content-Security-Policy` that allows
nothing else (images of a README may come from `https`), `nosniff` and `Referrer-Policy: same-origin`. Its look is
neutral for now: the name from the config is its title, and it shows no logo.

## Use as a library

```js
import http from 'node:http';
import { createApp, loadConfig, scan, scanAssets } from 'dropr';

const config = loadConfig('dropr.config.json');
const logger = { request: () => {}, error: console.error };

const app = createApp(config, {
    index: scan(config.packagesDir, logger),
    packagesDir: config.packagesDir,
    assets: scanAssets(config.assets, logger),
    version: '1.0.0',
    logger,
});

http.createServer(app).listen(config.port);
```

The config needs `manifest.baseUrl`. `dropr serve` also keeps a type folder out of the names of the assets (the third
argument of `scan`, the first segment of each asset URL), so do not name a type like an asset.

`createHandler` answers a `fetch` `Request` with a `Response`, so the same core can serve a worker or a test:

```js
import { buildManifest, createHandler, createReader, loadIndex, parseConfig, scan } from 'dropr';

const config = parseConfig({ manifest: { baseUrl: 'https://cdn.example.com' } });
const logger = { error: console.error };

const handler = createHandler({
    catalog: loadIndex(scan('packages', logger)),
    name: config.name,
    version: '1.0.0',
    manifest: buildManifest(config.manifest, config.name, '1.0.0'),
    read: createReader('packages'),
    assets: {},
    clientHeader: null,
    rateLimit: config.rateLimit,
    logger,
});

const response = await handler(new Request('http://localhost/health'), '127.0.0.1');
```

The second argument is the address of the client. `loadIndex` takes the index that `scan` builds or one read from a JSON
file, and `read(path, range?)` is any function that returns a stream of the file; `createReader` is the one over a
folder. `createResponder` takes the same options and returns the status, headers and body without building a `Response`.
Add `ui: true` to the options to answer a browser with the pages, the READMEs being read through `read`. `parseConfig` and
the types of the API are exported too.

### Without Node

`dropr/core` exports `parseConfig`, `loadIndex`, `createHandler`, `createResponder` and `buildManifest` with their types,
and imports no Node module, so a runtime that has a `fetch` API and no disk can load it. Write the index ahead with
`dropr index --out index.json` (or `JSON.stringify(scan(...))`), read it with `loadIndex(JSON.parse(text))`, and give
`createHandler` a `read` function of your own; the rest of the options are those above.

- The rate limit and the uptime of `/health` live in the handler, so they are those of one instance, and use `Date.now()`.
- `/download` needs `CompressionStream`, and `parseConfig` needs `URL.canParse`.
- `memory` is optional: without it, `/health` leaves the memory out.

## Stack

Node.js, strict TypeScript (ESM), [@moxon/limiter](https://github.com/moxondev/limiter),
[@20syldev/logger.ts](https://github.com/20syldev/logger.ts)

## Scripts

| Script                | Description                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `npm run dev`         | Dev server, reloaded on change (tsx watch)                                                    |
| `npm run build`       | Compile TypeScript to `dist/`                                                                 |
| `npm start`           | Production server (`dropr serve`, after `npm run build`) on the port of the config or `$PORT` |
| `npm run check`       | Type checks (Node-free core included), ESLint, Prettier                                       |
| `npm test`            | Route snapshots, config, router, core, HTTP rules, CLI, package                               |
| `npm run test:update` | Record the snapshots again after an intended change                                           |
| `npm run format`      | Prettier and ESLint fixes on `src/` and `test/`                                               |

## Structure

```
src/lib/        Node-free core: router, routes, packages, semver, checksums, HTTP rules, CORS, tar archive, responder, pages, Markdown
src/            Command line and Node adapter: bin, cli, serve, check, indexer, folder, stored, startup, app, scan, assets, config, disk, index
src/manifest.ts Route texts of /manifest, also Node-free
src/core.ts     Entry of the core alone, exported as dropr/core
test/           Snapshots on a generated tree, unit and HTTP tests, the ledger of decided changes of a release
```
