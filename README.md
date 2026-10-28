# dropr

Personal CDN that stores, versions and serves bash scripts, npm packages and shared configurations, at [dropr.sylvain.sh](https://dropr.sylvain.sh). Every published version is frozen and served as is, with its SHA-256 checksums and a `.tar.gz` archive.

## Features

- Versioned URLs, `/<type>/<project>@<version>/<file>`: `@latest` and partial versions (`@6`, `@6.1`) resolve to the newest stable release; a pre-release is only picked when no stable one matches, or by its exact number (`@6.0.0-pre`).
- Files served with their real content type (`application/json`, `text/javascript`...) and `X-Content-Type-Options: nosniff`; extensionless scripts and unknown extensions as UTF-8 plain text, so they display in a browser.
- Files of an exact version cached for a year as immutable, those reached through `@latest` or a partial version for 5 minutes, since they move with the next release; every file has an `ETag` and answers `304` to `If-None-Match`.
- JSON listings of every type, project, version and folder, with file sizes; SHA-256 checksums of a version (`?checksums`) and its `.tar.gz` archive (`?download` or `/download/...`).
- Changelog of a project with release dates, search by name or type, route manifest (`/manifest`) and health check (`/health`).
- Deprecated projects stay reachable at their old address, frozen at their last version: JSON responses carry a `deprecated` field (date, message, successor), and every response under the project a `Deprecation` header and a `Link` to the successor.
- One error body for every status: `{ "status": 404, "error": "Not Found", "message": "..." }`.
- Files served from inside their version folder only: no `..`, and a symlink only when its target stays inside.
- Rate limit of 100 requests per 10 seconds per client and 1000 per 10 seconds overall, answered with a `429`; CORS open to every origin, with the `Deprecation`, `Link`, `ETag` and `Content-Disposition` headers exposed.

## Usage

```bash
curl -O https://dropr.sylvain.sh/bash/gft@latest/gft              # a file
curl https://dropr.sylvain.sh/bash/gft@1.0.6                      # the files of a version, with their size
curl "https://dropr.sylvain.sh/bash/gft@1.0.6?checksums"          # their SHA-256
curl -OJ https://dropr.sylvain.sh/download/bash/gft@1.0.6         # the whole version, as gft-1.0.6.tar.gz
```

## Routes

| Route                                         | Description                                                       |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `/`                                           | Every type, project and version                                   |
| `/<type>`                                     | Projects of a type                                                |
| `/<type>/<project>`                           | Versions of a project, `latest` included                          |
| `/<type>/<project>@<version>`                 | Files of a version, with their size                               |
| `/<type>/<project>@<version>/<path>`          | A file, or the listing of a folder                                |
| `/<type>/<project>@<version>?checksums`       | SHA-256 of every file of a version                                |
| `/<type>/<project>@<version>?download`        | The version as `.tar.gz`                                          |
| `/<type>/<project>/changelog`                 | Versions with their release date                                  |
| `/download`, `/download/<type>`               | Archive links (latest and every version), of every type or of one |
| `/download/<type>/<project>@<version>`        | The version as `.tar.gz`, the latest one if omitted               |
| `/search?q=<term>`                            | Projects whose name contains the term, or every project of a type |
| `/manifest`                                   | Description of every route                                        |
| `/health`                                     | Name, status, version, uptime, package count and memory           |
| `/favicon.svg`, `/favicon.ico`, `/robots.txt` | The dropr mark and the crawler rules                              |

## Publishing a version

```bash
# From a GitHub release: clones the tag, builds it when it has a build script, copies it
npm run fetch -- 20syldev/gft packages/bash 1.0.7

# From the published npm tarball, the method used for the npm packages
npm run fetch -- --npm @moxon/api moxondev/api packages/npm 6.2.0 moxon
```

`fetch.sh [options] <user/repo> <path> [version] [name]`: the version defaults to the latest GitHub release (the npm `latest` tag with `--npm`), the name to the repository's. `--force` replaces an existing version, `--no-build` skips the build and `--exclude <pattern>` leaves files out. Needs git, rsync and npm, and uses gft when installed.

The release date comes from the GitHub release, or is today's when there is none, and is recorded in the project's `.versions.json`. A deprecated project refuses new versions and names its successor. The server reads `packages/` once at startup: commit the new version, then redeploy (or restart) for it to be served.

## Stack

Node.js, Express 5, strict TypeScript (ESM), @20syldev/logger.ts

## Scripts

| Script                  | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `npm run dev`           | Dev server on port 4000, reloaded on change (tsx watch)       |
| `npm run build`         | Compile TypeScript to `dist/`                                 |
| `npm start`             | Production server on port 4000, or `$PORT`                    |
| `npm run fetch`         | Publish a version into `packages/` (`scripts/fetch.sh`)       |
| `npm run check`         | `tsc --noEmit` + ESLint (`src/` and `scripts/`)               |
| `npm run format`        | Prettier + ESLint (write)                                     |
| `npm run upgrade:minor` | Update the dependencies within their ranges                   |
| `npm run upgrade:major` | Move every dependency to its latest major (npm-check-updates) |

## Structure

```
packages/         Published versions, as packages/<type>/<project>/<version>/
public/           Favicon: the dropr mark, a vermilion box falling into its tray (SVG and ICO)
scripts/          fetch.sh (version publishing), versions.mjs (release dates)
src/app.ts        Express server: middlewares, routes and error handling
src/manifest.ts   Description of every route, served on /manifest
src/lib/          Package scan, version resolution, deprecations, release dates, sizes, paths, archives, checksums, MIME types, errors, rate limit
src/types/        Shared types and the Express request and response augmentations
robots.txt        Crawler rules, served on /robots.txt
```

## Notes

- A full version must exist as is: `@6.0.0` answers 404 while only `6.0.0-pre` is published, whereas `@6.0` resolves to it.
- Archives are named `<project>-<version>.tar.gz` and unpack into a `<version>/` folder.
- `.versions.json` (release dates) and `.deprecated.json` (deprecation notice) sit next to the version folders of a project, so they never show up in listings, archives or checksums.
- In production: `npm install && npm run build`, then `npm start`; archives need `tar` on the host.
- Version `3.3.0` changes what clients see: `error` now holds the HTTP reason phrase and `message` the detail (the other way around until `3.2.2`), `status` is a number instead of a string, files carry their own content type instead of `text/plain`, and only exact versions stay immutable (`3.2.2` cached `@latest` for a year).
