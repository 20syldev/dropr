# dropr

Personal CDN that stores, versions and serves bash scripts, npm packages and shared configurations, at [dropr.sylvain.sh](https://dropr.sylvain.sh). Every published version is frozen and served as is, with its SHA-256 checksums and a `.tar.gz` archive.

## Features

- Versioned URLs, `/<type>/<project>@<version>/<file>`: `@latest` and partial versions (`@6`, `@6.1`) resolve to the newest stable release; a pre-release is only picked when no stable one matches, or by its exact number (`@6.0.0-pre`).
- Files served with their real content type (`application/json`, `text/javascript`...) and `X-Content-Type-Options: nosniff`; extensionless scripts and unknown extensions as UTF-8 plain text, so they display in a browser.
- Files of an exact version cached for a year as immutable, those reached through `@latest` or a partial version for 5 minutes, since they move with the next release; every file has an `ETag` and answers `304` to `If-None-Match`.
- JSON listings of every type, project, version and folder, with file sizes; SHA-256 checksums of a version (`?checksums`) and its `.tar.gz` archive (`?download` or `/download/...`).
- Changelog of a project with release dates, search by name or type, route manifest (`/manifest`) and health check (`/health`).
- Deprecated projects stay reachable at their old address, frozen at their last version: JSON responses carry a `deprecated` field (date, message, successor), and every response under the project a `Deprecation` header and a `Link` to the successor.
- One error body for every status: `{ "status": 404, "error": "Not Found", "message": "..." }`; a method other than `GET` or `HEAD` gets a `405`.
- Files served from inside their version folder only: no `..`, and a symlink only when its target stays inside; listings, sizes and checksums follow the same rule.
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

| Script                  | Description                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run dev`           | Dev server on the port of the config file (4000), reloaded on change (tsx watch)                                 |
| `npm run build`         | Compile TypeScript to `dist/`                                                                                    |
| `npm start`             | Production server (`dist/serve.js`) on the port of the config file, or `$PORT`                                   |
| `npm run fetch`         | Publish a version into `packages/` (`scripts/fetch.sh`)                                                          |
| `npm run check`         | Type checks, the Node-free core included, ESLint, Prettier (`src/`, `scripts/`, `test/` and `dropr.config.json`) |
| `npm test`              | Route snapshots, `createApp`, config parser, core and tar writer, entry point, sweep of `packages/`              |
| `npm run test:update`   | Record the snapshots again after an intended change                                                              |
| `npm run format`        | Prettier + ESLint (write)                                                                                        |
| `npm run upgrade:minor` | Update the dependencies within their ranges                                                                      |
| `npm run upgrade:major` | Move every dependency to its latest major (npm-check-updates)                                                    |

## Structure

```
.github/          CI: checks and tests on every push to master and every pull request
packages/         Published versions, as packages/<type>/<project>/<version>/
public/           Favicon: the dropr mark, a vermilion box falling into its tray (SVG and ICO)
scripts/          fetch.sh (version publishing), versions.mjs (release dates)
src/app.ts        createApp(config, deps): Express app with static files, logs, rate limit, /health and /manifest, then route() for every other request; reads no env and listens nowhere
src/serve.ts      Entry point: reads the config file and the env, indexes packages/, builds the app and listens
src/config.ts     loadConfig(): reads the config file and resolves its paths against the folder of the file
src/scan.ts       Startup index of packages/: folders, files, links, sizes, release dates, deprecations and SHA-256
src/manifest.ts   Routes and English texts of /manifest, built by buildManifest() with the overrides of the config
src/lib/          Node-free core: route(), index loading, version resolution, paths, checksums, tar writer, MIME types, errors, deprecations, rate limiter, config parser
src/types/        Shared types: the index and its catalog, route requests and responses, tar entries, config and logger
test/             Route snapshots on a generated tree (cases.mjs, fixture.mjs), createApp and the entry point (app.test.mjs), config parser and manifest (config.test.mjs), route() and the limiter in process (core.test.mjs), tar writer (tar.test.mjs), sweep of packages/, HTTP and tar helpers
dropr.config.json Config of the instance: name, port, packages folder, client IP header, base URL and assets
robots.txt        Crawler rules, served on /robots.txt
```

## Notes

- A full version must exist as is: `@6.0.0` answers 404 while only `6.0.0-pre` is published, whereas `@6.0` resolves to it.
- The server reads `packages/` once at startup into an index (`src/scan.ts`): listings, sizes, checksums, release dates and file ETags come from it, so a folder made unreadable after startup keeps being listed, a file added after startup only shows after a restart, and one edited in place keeps its startup ETag and checksum until then. What cannot be read at startup is logged: a file or a version that cannot be stat'ed is left out, and a folder that cannot be listed fails only the routes that need it, a download of its version logging an `Archive error` line that names the version.
- A missing `packages/` folder is logged and serves an empty index instead of stopping the server; `/health` then counts 0 packages.
- `src/lib/` and `src/manifest.ts` use no Node API (no built-in module, `process`, `Buffer`, timer or `console`), so the core can move to another JavaScript runtime; ESLint and `tsc -p tsconfig.core.json` check it.
- Archives are named `<project>-<version>.tar.gz` and unpack into a `<version>/` folder. They are written in JS (ustar, pax for long names): entries in strcmp order, mode `0755` for folders and executables, `0644` for other files and `0777` for links, owner `0/0`, and every entry dated the release date of the version, so a version gives the same tar bytes on every deploy. When a file cannot be read midway, or no longer has its startup size, the connection is reset instead of ending, so `curl -f` fails rather than keeping a partial archive. Files are read whole, so a version holding a file of 2 GiB or more cannot be archived: its download resets.
- `.versions.json` (release dates) and `.deprecated.json` (deprecation notice) sit next to the version folders of a project, so they never show up in listings, archives or checksums.
- In production: `npm install && npm run build`, then `npm start`; the committed lockfile pins what gets installed, and the host no longer needs `tar`.
- `dropr.config.json` at the repository root holds everything specific to an instance, and is required: a file that is missing, is not JSON or is refused prints `Invalid config: ...` and exits with 1 without listening. The path of another file is the first argument, `node dist/serve.js path/to/config.json`. Unknown keys are refused, and a relative path is resolved against the folder of the file.
- Keys and defaults: `name` (`"dropr"`, used by `/health`, `/manifest` and the startup banner), `port` (`4000`), `packagesDir` (`"packages"`), `clientIp.header` (`null`, the header that names the client for the rate limit) and `clientIp.trustProxy` (`false`), `manifest.baseUrl` (required: an http or https URL without a trailing slash, space or control character), `manifest.params` and `manifest.routes` (`{}`, overrides of the manifest texts, below) and `assets` (`{}`, a URL path mapped to the file served there).
- `PORT` and `PACKAGES_DIR` win over `port` and `packagesDir`; `PACKAGES_DIR` serves another tree than `packages/`, as the tests do with a tree they generate in the system temp folder.
- The client for the rate limit is the value of `clientIp.header` when the request carries one, so set it only behind a proxy that rewrites that header; otherwise it is the socket address, or the address `X-Forwarded-For` gives when `clientIp.trustProxy` is `true`.
- The manifest has English texts built into `src/manifest.ts`; an instance overrides them in its config, per field and only where it wants to: `manifest.params.<type|project|version|file|q>` takes `name` (path params only), `description` and `example`, and `manifest.routes.<id>` takes `title`, `summary`, `example` and `notes`, with the ids and params listed on `/manifest`. A field left out keeps its default, `notes` replaces the whole list, and a renamed path param is renamed in the paths and in every note, the notes of the config included, so write `{name}` for the new name of a path param there.
- `createApp(config, { index, packagesDir, version, logger })` reads no env, argument or file at creation, and neither scans, listens nor prints: `src/serve.ts` does, so importing `dist/app.js` has no side effect and every app has its own rate limiter. It takes a config that went through `parseConfig`.
- The tests start the app in process on a loopback port, with a logger that records what the app reports, and run `dist/serve.js` in a child process for its arguments, env and exit code only.
- The tests need Node 24, GNU tar (to check the archives) and a regular user: root can read a file of mode `000`, so the cases that rely on one are skipped, and `npm run test:update` would then drop their snapshots. With `CI` set, these cases fail instead of being skipped.
- The CI runs `npm run check` and `npm test` on Node 24 for every push to `master` and every pull request.
- Version `3.3.0` changes what clients see: `error` now holds the HTTP reason phrase and `message` the detail (the other way around until `3.2.2`), `status` is a number instead of a string, files carry their own content type instead of `text/plain`, and only exact versions stay immutable (`3.2.2` cached `@latest` for a year).
- Version `3.4.0` serves `/manifest` in English, with renamed path placeholders (`{project}` and `{file}`), and moves the startup to `dist/serve.js`: `npm start` follows, but a host that runs `node dist/app.js` must switch. `.htaccess` is gone, and a missing or invalid `dropr.config.json` now stops the server.
