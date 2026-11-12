# Routes

## Paths

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
| `/-/docs`, `/-/docs/<page>`             | These docs, when `ui.docs` is on                                  |
| Any path listed in `assets`             | The configured file (`GET` and `HEAD`), served before the routes  |

A type may not be `download`, `health`, `manifest` or `search`, nor the first segment of a configured asset.

## Versions

`@latest` and a partial version (`@6`, `@6.1`) resolve to the newest stable release. A pre-release is chosen only when no stable one matches, or by its exact number (`@6.0.0-pre`). The files of an exact version are cached for a year (`immutable`), those reached through `@latest` or a partial version for 5 minutes.

## Pages

With `ui` on, a page is sent when `text/html` (or `application/xhtml+xml`) is named in `Accept` with a higher quality than `application/json`. A script, `curl` or `fetch()` sends `*/*` or nothing, and keeps the JSON. The answers of those paths carry `Vary: Accept`.

Files are never pages: a file, a missing file, `?checksums`, `?download`, `/manifest`, `/health` and `/download` answer as before. The pages of a deprecated project carry its `Deprecation` and `Link` headers, as its JSON does.

A page is one document with its style inline, no script and no font. Its `Content-Security-Policy` allows nothing else than images from the site itself or from `https` (the logo, the favicon and the images of a README) and a form that goes to the search, and it is sent with `nosniff` and `Referrer-Policy: same-origin`.

The README of a version is its `README.md` (or `README.markdown`) at the root, up to 256 KiB. It is rendered by a Markdown reader that writes raw HTML as text, drops comments and follows only `http`, `https` and `mailto` links. A README that cannot be read is left out and logged.

The docs at `/-/docs` have no JSON form: they answer with a page whatever `Accept` says, without `Vary`.

See [Configuration](config#ui) to turn the pages and the docs on.
