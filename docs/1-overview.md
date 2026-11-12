# Overview

dropr is a small server for a versioned CDN. It serves bash scripts, npm packages and shared configurations from a folder of frozen versions, with their SHA-256 checksums and a `.tar.gz` archive of each one. It reads the folder once at startup and needs no database.

## Install

```bash
npm install dropr
```

Node.js 24 or later is needed.

## Quick start

Lay the versions out as `packages/<type>/<project>/<version>/` and give each project a `.versions.json` with the release date of every version:

```
packages/bash/hello/.versions.json  { "1.0.6": { "date": "2025-09-12" } }
packages/bash/hello/1.0.6/hello
```

Check the folder, then serve it:

```bash
npx dropr check     # reports what the server would skip, without listening
npx dropr serve     # indexes the packages and listens on port 4000
```

Ask for a file, a version, its checksums or its archive:

```bash
curl -O http://localhost:4000/bash/hello@latest/hello     # a file
curl http://localhost:4000/bash/hello@1.0.6               # the files of a version, with their size
curl "http://localhost:4000/bash/hello@1.0.6?checksums"   # their SHA-256
curl -OJ http://localhost:4000/download/bash/hello@1.0.6  # the whole version, as hello-1.0.6.tar.gz
```

## Pages for browsers

The same paths can answer a browser with pages: the packages by type, a project with its versions and its README, a version with its files, and a search. They are off by default and turned on with `ui` in the configuration. Every other client keeps getting the JSON.

## Next

- [Configuration](config) lists every key of `dropr.config.json`, the look of the pages and these docs.
- [Routes](routes) lists every path the server answers and how a browser is told from a script.
