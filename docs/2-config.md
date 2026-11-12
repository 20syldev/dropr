# Configuration

The configuration is a JSON file. `dropr serve` reads the file named on the command line, else `dropr.config.json` of the working folder, else the defaults. A named file must exist, and an unknown key is refused.

```json
{
    "name": "dropr",
    "port": 4000,
    "packagesDir": "packages",
    "clientIp": { "header": "x-real-ip" },
    "rateLimit": { "window": 10, "client": 100, "global": 1000 },
    "manifest": { "baseUrl": "https://dropr.example.com" },
    "assets": { "/robots.txt": "robots.txt", "/logo.svg": "logo.svg", "/favicon.ico": "favicon.ico" },
    "ui": { "accent": "#1d4ed8", "logo": "/logo.svg", "favicon": "/favicon.ico", "docs": true }
}
```

## Keys

| Key                | Default      | Description                                                                                                           |
| ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `name`             | `"dropr"`    | Shown by `/health`, `/manifest`, the startup banner and the title of the pages                                        |
| `port`             | `4000`       | Port to listen on, from 0 (a free port) to 65535; `--port` and `PORT` take 1 to 65535                                 |
| `packagesDir`      | `"packages"` | Folder of the packages, resolved against the folder of the config file                                                |
| `clientIp.header`  | `null`       | Header that names the client; set it only behind a proxy that rewrites it                                             |
| `rateLimit.window` | `10`         | Window in seconds                                                                                                     |
| `rateLimit.client` | `100`        | Requests per client over a sliding window                                                                             |
| `rateLimit.global` | `1000`       | Requests over a fixed window, `null` for no cap                                                                       |
| `manifest.baseUrl` | required     | Base URL of the instance, `http` or `https`, with no trailing slash; without a config file, `http://localhost:<port>` |
| `manifest.params`  | `{}`         | Overrides of the texts of `/manifest`                                                                                 |
| `manifest.routes`  | `{}`         | The same, per route                                                                                                   |
| `assets`           | `{}`         | A URL path mapped to the file served there, read at startup                                                           |
| `ui`               | `false`      | `true`, or an object, to answer a browser with pages; see below                                                       |
| `ui.accent`        | none         | Color of the pages, written `#rrggbb`                                                                                 |
| `ui.logo`          | none         | URL path of an entry of `assets`, shown before the name                                                               |
| `ui.favicon`       | none         | URL path of an entry of `assets`, the icon of the tab                                                                 |
| `ui.docs`          | `false`      | `true` to serve these docs at `/-/docs`                                                                               |

Without `clientIp.header` the client is the socket address, and `X-Forwarded-For` is never read. A refused request does not count against the limit, and a `429` tells in `Retry-After` how many seconds to wait. Assets and `OPTIONS` preflights are answered before the limit and never count against it.

## ui

With `"ui": true`, a browser gets a page where every other client gets the JSON, from the same URL. An object keeps the pages on and sets their look; an empty object, like `true`, keeps the default look. A key that is not known is refused.

The accent colors the buttons and the focus ring. The links and the ring get the closest shade of it that reads at 4.5:1 on the light and on the dark theme, and a button gets a white or a dark label, whichever reads better. The logo is shown before the name, which stays the title.

`ui.docs` adds these docs to the pages, at `/-/docs`. The path starts with a dash, which no type or project can, so it never hides a package. With `ui: true` or without `docs`, the docs are off and the path answers as any route that does not exist.
