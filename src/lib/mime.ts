const FALLBACK = 'text/plain; charset=utf-8';

// Explicit content types by extension, so .ts sources are not served as video/mp2t like a generic MIME database would
const TYPES: Record<string, string> = {
    '.cjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.gz': 'application/gzip',
    '.htm': 'text/html; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.otf': 'font/otf',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.tgz': 'application/gzip',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml; charset=utf-8',
    '.yaml': 'text/yaml; charset=utf-8',
    '.yml': 'text/yaml; charset=utf-8',
    '.zip': 'application/zip',
};

/**
 * Reads the extension of the last component of a POSIX path, as Node's path.extname does.
 * Trailing slashes are ignored, and a name whose only dot is its first character, or '..', has no extension.
 *
 * @param path - File name or path, '/' being the only separator
 * @returns The extension from the last dot, the dot included and possibly alone, or an empty string
 */
function extname(path: string): string {
    let end = path.length;
    while (end > 0 && path[end - 1] === '/') end--;

    const name = path.slice(path.lastIndexOf('/', end - 1) + 1, end);
    const dot = name.lastIndexOf('.');

    return dot > 0 && name !== '..' ? name.slice(dot) : '';
}

/**
 * Picks the Content-Type of a package file from its extension.
 * Unknown or missing extensions (shell scripts, LICENSE, .ts sources) are served
 * as UTF-8 plain text, so they display in a browser instead of downloading.
 *
 * @param file - File name or path, only its extension is read, in any case
 * @returns The Content-Type header value, UTF-8 plain text for an unknown extension
 */
export function contentType(file: string): string {
    const ext = extname(file).toLowerCase();

    return Object.hasOwn(TYPES, ext) ? TYPES[ext] : FALLBACK;
}
