# dropr

Personal CDN that stores, versions and serves bash scripts, npm packages and shared configurations, at [dropr.sylvain.sh](https://dropr.sylvain.sh). Every published version is frozen and served as is, with its SHA-256 checksums and a `.tar.gz` archive.

## Features

- Versioned URLs, `/<type>/<project>@<version>/<file>`: `@latest` and partial versions (`@6`, `@6.1`) resolve to the newest stable release; a pre-release is only picked when no stable one matches, or by its exact number (`@6.0.0-pre`).
- Files served with their real content type (`application/json`, `text/javascript`...) and `X-Content-Type-Options: nosniff`; extensionless scripts and unknown extensions as UTF-8 plain text, so they display in a browser.
- Files of an exact version cached for a year as immutable, those reached through `@latest` or a partial version for 5 minutes, since they move with the next release; every file has an `ETag`, the SHA-256 of its bytes in quotes, and answers `304` to `If-None-Match`.
- JSON listings of every type, project, version and folder, with file sizes; SHA-256 checksums of a version (`?checksums`) and its `.tar.gz` archive (`?download` or `/download/...`).
- Changelog of a project with release dates, search by name or type, route manifest (`/manifest`) and health check (`/health`).
- Deprecated projects stay reachable at their old address, frozen at their last version: JSON responses carry a `deprecated` field (date, message, successor), and every response under the project a `Deprecation` header and a `Link` to the successor.
- One error body for every status: `{ "status": 404, "error": "Not Found", "message": "..." }`; a method other than `GET` or `HEAD` gets a `405`.
- Files served from inside their version folder only: `..` is resolved by the URL before routing, never by the file system, and a symlink is followed only when its target stays inside; listings, sizes and checksums follow the same rule.
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

`fetch.sh [options] <user/repo> <path> [version] [name]`: the version defaults to the latest GitHub release (the npm `latest` tag with `--npm`), the name to the repository's. `--force` replaces an existing version once the new one is fetched (a failed fetch keeps the old one), `--no-build` skips the build and `--exclude <pattern>` leaves files out. Needs git, rsync and npm, and uses gft when installed.

The version names the folder and must be `X.Y.Z` or `X.Y.Z-tag` as semver.org writes them: a leading `v` of the tag is dropped (`v1.0.7` is stored as `1.0.7`), and anything else (`1.0`, `01.0.0`, `1.0.0+build`) stops the script before it creates anything, since the server would leave that folder out.

The release date comes from the GitHub release, or is today's UTC day when there is none, and is recorded in the project's `.versions.json` before any file is copied; `versions.mjs` refuses a version or a day the server would not read and leaves the file alone. The date is the `Last-Modified` of the files of that version. A deprecated project refuses new versions and names its successor. The server reads `packages/` once at startup: commit the new version, then redeploy (or restart) for it to be served.

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
| `npm test`              | Route snapshots, `createApp`, config parser, router, core and tar writer, entry point, sweep of `packages/`      |
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
src/lib/          Node-free core: route(), path router, index loading, semver and byte order, version resolution, paths, checksums, tar writer, MIME types, errors, deprecations, rate limiter, config parser
src/types/        Shared types: the index and its catalog, route input, match and response, tar entries, config and logger
test/             Route snapshots on a generated tree (cases.mjs, fixture.mjs), createApp and the entry point (app.test.mjs), config parser and manifest (config.test.mjs), path router (router.test.mjs), route() and the limiter in process (core.test.mjs), tar writer (tar.test.mjs), the ledger of the behaviour decisions of a release and the checks that bind it to the cases (cases.mjs tags, changes.mjs, changes.test.mjs), sweep of packages/, HTTP and tar helpers
dropr.config.json Config of the instance: name, port, packages folder, client IP header, base URL and assets
robots.txt        Crawler rules, served on /robots.txt
```

## Notes

- A full version must exist as is: `@6.0.0` answers 404 while only `6.0.0-pre` is published, whereas `@6.0` resolves to it.
- The server reads `packages/` once at startup into an index (`src/scan.ts`): listings, sizes, checksums, release dates and file ETags come from it, so a folder made unreadable after startup keeps being listed, a file added after startup only shows after a restart, and one edited in place keeps its startup ETag and checksum until then. What the scan refuses is logged and never stops the server (see the scan policy below).
- A missing `packages/` folder is logged and serves an empty index instead of stopping the server; `/health` then counts 0 packages.
- The index is a JSON document of format 2 with no null in it: types, projects, versions and entries in UTF-8 byte order (versions in semver order), a file with its size, execute flag and SHA-256, a link with its target and, when it leads to a node of the version, its real path. `loadIndex()` checks the whole document and derives what the routes read (folder sizes, the latest version of each project, the release time of each version), so an index built elsewhere is served exactly like the one `scan()` builds: a fault throws `Invalid packages index: <place> <fault>.` and another format `Unsupported packages index format: <n>`. The index is never written to disk, so the format has no migration.
- `src/lib/` and `src/manifest.ts` use no Node API (no built-in module, `process`, `Buffer`, timer or `console`), so the core can move to another JavaScript runtime; ESLint and `tsc -p tsconfig.core.json` check it.
- Archives are named `<project>-<version>.tar.gz` and unpack into a `<version>/` folder. They are written in JS (ustar, pax for long names): entries in strcmp order, mode `0755` for folders and executables, `0644` for other files and `0777` for links, owner `0/0`, and every entry dated the release date of the version, so a version gives the same tar bytes on every deploy. When a file cannot be read midway, or no longer has its startup size, the connection is reset instead of ending, so `curl -f` fails rather than keeping a partial archive. Files are read whole, so a version holding a file of 2 GiB or more cannot be archived: its download resets.
- `.versions.json` (release dates) and `.deprecated.json` (deprecation notice) sit next to the version folders of a project, so they never show up in listings, archives or checksums. `.versions.json` maps a version to `{ "date": "YYYY-MM-DD" }` (other keys are ignored: older entries carry a `repo` that nothing reads and `fetch.sh` no longer writes), and `.deprecated.json` is `{ "date": "YYYY-MM-DD", "message": "...", "successor": "/npm/other" }`, the date being a real day and the successor a URL made of printable ASCII without a space, `<`, `>` or `"`.
- In production: `npm install && npm run build`, then `npm start`; the committed lockfile pins what gets installed, and the host no longer needs `tar`.
- `dropr.config.json` at the repository root holds everything specific to an instance, and is required: a file that is missing, is not JSON or is refused prints `Invalid config: ...` and exits with 1 without listening. The path of another file is the first argument, `node dist/serve.js path/to/config.json`. Unknown keys are refused, and a relative path is resolved against the folder of the file.
- Keys and defaults: `name` (`"dropr"`, used by `/health`, `/manifest` and the startup banner), `port` (`4000`), `packagesDir` (`"packages"`), `clientIp.header` (`null`, the header that names the client for the rate limit) and `clientIp.trustProxy` (`false`), `manifest.baseUrl` (required: an http or https URL without a trailing slash, space or control character), `manifest.params` and `manifest.routes` (`{}`, overrides of the manifest texts, below) and `assets` (`{}`, a URL path mapped to the file served there).
- `PORT` and `PACKAGES_DIR` win over `port` and `packagesDir`; `PACKAGES_DIR` serves another tree than `packages/`, as the tests do with a tree they generate in the system temp folder.
- The client for the rate limit is the value of `clientIp.header` when the request carries one, so set it only behind a proxy that rewrites that header; otherwise it is the socket address, or the address `X-Forwarded-For` gives when `clientIp.trustProxy` is `true`.
- The manifest has English texts built into `src/manifest.ts`; an instance overrides them in its config, per field and only where it wants to: `manifest.params.<type|project|version|file|q>` takes `name` (path params only), `description` and `example`, and `manifest.routes.<id>` takes `title`, `summary`, `example` and `notes`, with the ids and params listed on `/manifest`. A field left out keeps its default, `notes` replaces the whole list, and a renamed path param is renamed in the paths and in every note, the notes of the config included, so write `{name}` for the new name of a path param there.
- `createApp(config, { index, packagesDir, version, logger })` reads no env, argument or file at creation, and neither scans, listens nor prints: `src/serve.ts` does, so importing `dist/app.js` has no side effect and every app has its own rate limiter. It takes a config that went through `parseConfig`.
- The tests start the app in process on a loopback port, with a logger that records what the app reports, and run `dist/serve.js` in a child process for its arguments, env and exit code only.
- The tests need Node 24, GNU tar (to check the archives), bash, rsync (for the fetch.sh tests that copy files, skipped without it) and a regular user: root can read a file of mode `000`, so the cases that rely on one are skipped, and `npm run test:update` would then drop their snapshots. With `CI` set, these cases fail instead of being skipped.
- The CI runs `npm run check` and `npm test` on Node 24 for every push to `master` and every pull request.
- Version `3.3.0` changes what clients see: `error` now holds the HTTP reason phrase and `message` the detail (the other way around until `3.2.2`), `status` is a number instead of a string, files carry their own content type instead of `text/plain`, and only exact versions stay immutable (`3.2.2` cached `@latest` for a year).
- Version `3.4.0` serves `/manifest` in English, with renamed path placeholders (`{project}` and `{file}`), and moves the startup to `dist/serve.js`: `npm start` follows, but a host that runs `node dist/app.js` must switch. `.htaccess` is gone, and a missing or invalid `dropr.config.json` now stops the server.
- A request is read as a WHATWG URL, then every path segment is percent-decoded once before routing, so `/%73earch` and `/npm/lib/chang%65log` route like `/search` and `/npm/lib/changelog`. The URL resolves `.` and `..` first, in every spelling (`%2e`, `.%2E`...), and a `..` above the root stays at the root, so `.../lib@1.2.0/..` is the listing of the type and `.../lib@1.2.0/../1.2.0/index.js` names the project `1.2.0`. A backslash reads as a slash and a fragment is cut, as browsers and curl send them. The path alone is routed: `Host` and `X-Forwarded-Host` are never read, and an absolute-form target (`GET http://host/npm/lib`) is routed on its path and query, whatever its authority. `route()` itself answers `400` with `The request URL is not valid.` to a URL that does not parse or whose scheme is not `http` or `https`, which the adapter never builds.
- A segment that does not percent-decode answers `400` with `The path holds an invalid percent-encoding.`, before any `404`, with no `Deprecation` or `Link` header and no echo of the input. A segment that decodes to nothing, to a `/` or a `\`, or to a control character (NUL, a newline, DEL, C1) matches no route, so `%2F`, `%5C` and `%00` are never separators and one file has one URL; an empty segment (`//`) is a missing route too, and only `/` is the root.
- A path that matches no route answers `404` with `Route '<encoded path>' does not exist.`, which never echoes the query. Below a project without a version, only `<project>/changelog` is a route: any other deeper path (`/npm/lib/anything`) is that `404` once its type and project are checked, with the `Deprecation` and `Link` headers of a deprecated project, and a missing type or project keeps its own message. Under `/download`, a path that is not `/download`, `/download/<type>` or `/download/<type>/<project>[@<version>]` is that `404` too, and so is any path below `/search`.
- Route names (`download`, `search`, `changelog`) are matched in lower case only: `/Download/npm` is the package type `Download` and `/npm/lib/CHANGELOG` is a missing route. After a version, `changelog` is a file name, so `lib@1.0.0/changelog` serves that file or answers a missing file, and `lib@999/changelog` a missing version.
- A trailing slash marks a folder. It is accepted on `/`, `/download`, `/download/<type>`, `/<type>`, `/<type>/<project>`, `/<type>/<project>@<version>` and the folders of a version. On a file it answers a missing file, like any missing path, whose message echoes the slash, and on `/search`, an archive (`/download/<type>/<project>`) or the changelog it answers `Route '...' does not exist.`
- A project is split from its version at the last `@`, and an `@` in first or last place is no separator: `lib@` and `@1.0.0` name no project, `lib@@1.0.0` names the project `lib@`, and `lib@1.0.0@junk` names the project `lib@1.0.0`. Scoped names such as `@moxon/api` are not routed.
- The query is read with `URLSearchParams`: `q` must appear exactly once and not be blank, `checksums` and `download` count by their presence, and the number of keys is not limited. `Q=lib` is not `q`, and `+` in `q` is a space.
- A top-level folder of `packages/` named `download`, `search`, `health`, `manifest` or like the first segment of a configured asset (`favicon.ico`, `robots.txt`) is not a package type: the scan skips the whole folder and logs `Skipping type '<name>': reserved name.` `download` and `search` are compared exactly, so a `Download` or `Search` folder is a type; `health`, `manifest` and the assets are compared in any case, since `/health`, `/manifest` and the asset files still answer in any case. Before `3.5.0` only `download` and `search` hid their projects: a `Health` or `robots.txt` folder lost its own listing to the route but its projects stayed reachable, and no skip was logged.
- Version `3.5.0` changes how a URL is read, and nothing else: the 404 or 400 messages above, the trailing slash, case, `//`, `%2F`, `..` and backslash rules, the `@` split and the query are the visible changes, and a client that used to rely on a quirk (`lib@1.0.0@junk`, `dist//`, `/Download/npm`) now gets a `404`; `mn plugin install foo@1.2` builds `foo@1.2@latest` and is one of them. Files, ETags, listings, archives, checksums and every other answer keep their bytes.
- The `ETag` of a file is its checksum, `"<64 hex digits>"`, the value `?checksums` gives for it: it follows the bytes, so two files with the same content share a tag whatever their name, version or date, and a link has the tag of its target. Files are hashed in 1 MiB reads, so no size limit applies, and an index must carry the checksum of every file (`loadIndex()` refuses one without). The tag is strong, so `If-Match` and `If-Range` accept it; `If-None-Match` also takes a list, a weak copy (`W/"..."`) or `*`. Version `3.6.0` changed it, from a tag made of the size and the date of the file: clients holding the old tag download each file once more. Listings keep the weak tag that Express gives their body.
- `Last-Modified` is the release date of the version at 00:00:00 GMT, the same for every file of it and for its 200, 206, 304 and HEAD answers, and the date written in its archive entries; it no longer follows the date of the file or of the checkout, which `send` used to read (version `3.6.0`, so clients holding a stored date are served again once, or keep their stored date when it is later). A request that carries the tag of a file reached through more than 40 links now answers `404` like the same request without it, where it used to answer `304`.
- Scan policy. The scan never stops the server for what a tree holds: it logs one line and leaves out the smallest thing that is wrong, and only a packages folder that cannot be listed for another reason than missing, not a folder or denied stops it. The lines start with `Skipping <path>:`, `Error reading <path>:`, `Invalid ...` or `No packages folder ...`, so a check can count them; a clean tree logs nothing, as `packages/` does.
- A version is indexed whole or not at all: when a file or folder in it cannot be read, is a FIFO, a socket or a device, or has a name that no route can match (an empty name, `.`, `..`, or one holding a `/`, a `\` or a control character), the version is left out (`Skipping version <path>: it could not be read whole.`, after the line of the entry), so `@latest` stays on the release before it instead of serving a version with holes. A project left without a version (`Skipping project <path>: none of its versions could be indexed.`) and a type left without a project (`Skipping type '<name>': none of its projects could be indexed.`) are not served, so every project that is listed has a latest version.
- A folder in a project is a version only when it is named `X.Y.Z` or `X.Y.Z-tag` as semver.org writes them: numbers and numeric tag identifiers without a leading zero, no build metadata, ASCII only. Any other folder (`v1.0.0`, `1.0`, `latest`, `1.0.0@beta`, `.git`) is logged with `Skipping <path>: not a version name, expected X.Y.Z or X.Y.Z-tag.` and left out. Versions are listed in semver order, so `1.10.0` follows `1.9.0` and `6.0.0-pre` precedes `6.0.0`; the newest release is `latest`, or the newest pre-release in a project that has no release. A project folder named `list` or holding an `@`, which the router could not address as a project, is logged with `Skipping <path>: not a project name, no route can address it as one.`
- A release date is a real `YYYY-MM-DD` day from 1970 to today (UTC), and a version needs one in `.versions.json`. Every entry is read on its own: one that is not an object with such a date logs `Invalid date of <version> in <file>: expected a YYYY-MM-DD day, not after today.`, and a version without a usable date is left out with `Skipping version <path>: no release date in <file>.` A file that is not a JSON object logs `Invalid <file>: expected an object of versions.` and leaves out every version of the project. The date of the version folder is never used, since it moves with the checkout. A version in `.versions.json` that has no folder is ignored.
- A `.deprecated.json` whose successor is empty or cannot go in a `Link` header (a control character, a space, a character past ASCII, `<`, `>` or `"`) or whose date is not a real `YYYY-MM-DD` day is refused with `Invalid deprecation notice in <file>: expected a YYYY-MM-DD date, a message and a successor.`: the project is served without a notice, since such a notice used to fail every request under it.
- Type folders: every folder of `packages/` is a type except hidden ones and the names that a route or an asset answers (`download`, `search`, `health`, `manifest`, the first segment of every configured asset), which are logged with `Skipping type '<name>': reserved name.`; a type may be called `src`, `lib` or `node_modules`.
- Not checked by the scan: the case of names (`Lib` and `lib` are two projects on a case-sensitive disk), hidden folders above the versions (left out without a word, while a dotfile inside a version is served like any file) and links that loop or leave their version (they have no target and answer `404` where a path crosses them; `MAX_LINKS` bounds every path). A link in the tree above the versions, a FIFO or a socket there is logged with `Skipping <path>: not a folder, only folders are read at this level.`
