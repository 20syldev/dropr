import { ROUTES } from '../manifest.js';
import type { Config } from '../types/index.js';

// Keys of the params the routes take, which the manifest texts are filed under
const PARAM_KEYS = [...new Set(ROUTES.flatMap((spec) => spec.params.map(({ key }) => key)))];

// Keys of the path params, the only ones whose placeholder can be renamed, since a query param is its own name
const PATH_KEYS = [
    ...new Set(ROUTES.flatMap((spec) => spec.params.filter(({ in: where }) => where === 'path').map(({ key }) => key))),
];

/**
 * Refuses a config with a message that names the faulty key.
 *
 * @param path - Dotted path of the key, empty for the file itself
 * @param reason - What the value must be
 * @returns Never, it always throws
 */
function fail(path: string, reason: string): never {
    throw new Error(`Invalid config: ${path || 'the file'} ${reason}`);
}

/**
 * Checks that a value is an object whose keys are all known, so a typo fails instead of being ignored.
 *
 * @param value - Value read from the file, undefined standing for an absent section
 * @param path - Dotted path of the section, for the messages
 * @param known - Keys the section accepts; a null list accepts any key
 * @returns The section, an empty object when absent
 */
function section(value: unknown, path: string, known: string[] | null): Record<string, unknown> {
    if (value === undefined) return {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be an object');

    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (known && !known.includes(key)) fail(`${path}${path ? '.' : ''}${key}`, 'is not a known key');
    }

    return record;
}

/**
 * Reads an optional string.
 *
 * @param value - Value read from the file
 * @param path - Dotted path of the key, for the messages
 * @param fallback - Value of an absent key
 * @returns The string, which may be empty
 */
function text<T extends string | undefined>(value: unknown, path: string, fallback: T): string | T {
    if (value === undefined) return fallback;
    if (typeof value !== 'string') fail(path, 'must be a string');

    return value;
}

/**
 * Validates the content of a config file and fills the defaults in, without touching the disk or the env.
 * Paths stay as written; loadConfig resolves them against the file.
 *
 * @param input - Parsed JSON; only manifest.baseUrl is required
 * @returns The complete config; throws an Error whose message starts with "Invalid config:" and names the key
 */
export function parseConfig(input: unknown): Config {
    const root = section(input, '', ['name', 'port', 'packagesDir', 'clientIp', 'manifest', 'assets']);
    const clientIp = section(root.clientIp, 'clientIp', ['header', 'trustProxy']);
    const manifest = section(root.manifest, 'manifest', ['baseUrl', 'params', 'routes']);

    const name = text(root.name, 'name', 'dropr');
    if (!name) fail('name', 'must not be empty');

    const port = root.port ?? 4000;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) {
        fail('port', 'must be an integer from 0 to 65535');
    }

    const packagesDir = text(root.packagesDir, 'packagesDir', 'packages');
    if (!packagesDir) fail('packagesDir', 'must not be empty');

    const header = clientIp.header ?? null;
    if (header !== null && (typeof header !== 'string' || !/^[A-Za-z0-9-]+$/.test(header))) {
        fail('clientIp.header', 'must be null or a header name');
    }

    const trustProxy = clientIp.trustProxy ?? false;
    if (typeof trustProxy !== 'boolean') fail('clientIp.trustProxy', 'must be true or false');

    const baseUrl = text(manifest.baseUrl, 'manifest.baseUrl', undefined);
    if (baseUrl === undefined) fail('manifest.baseUrl', 'is required');
    const blank = [...baseUrl].some((char) => char < '!' || char === '\x7f');
    if (!/^https?:\/\/[^/]/.test(baseUrl) || baseUrl.endsWith('/') || blank || !URL.canParse(baseUrl)) {
        fail('manifest.baseUrl', 'must be an http or https URL without a trailing slash, space or control character');
    }

    const params = section(manifest.params, 'manifest.params', PARAM_KEYS);
    for (const [key, value] of Object.entries(params)) {
        const fields = section(
            value,
            `manifest.params.${key}`,
            PATH_KEYS.includes(key) ? ['name', 'description', 'example'] : ['description', 'example'],
        );
        for (const [field, entry] of Object.entries(fields)) text(entry, `manifest.params.${key}.${field}`, '');
        if (typeof fields.name === 'string' && !/^\w+$/.test(fields.name)) {
            fail(`manifest.params.${key}.name`, 'must be letters, digits and underscores');
        }
    }

    const placeholders = PATH_KEYS.map((key) => (params[key] as { name?: string } | undefined)?.name ?? key);
    if (new Set(placeholders).size !== placeholders.length)
        fail('manifest.params', 'must give the path params different names');

    const routes = section(
        manifest.routes,
        'manifest.routes',
        ROUTES.map(({ id }) => id),
    );
    for (const [id, value] of Object.entries(routes)) {
        const path = `manifest.routes.${id}`;
        const fields = section(value, path, ['title', 'summary', 'example', 'notes']);
        for (const [field, entry] of Object.entries(fields)) {
            if (field !== 'notes') text(entry, `${path}.${field}`, '');
            else if (!Array.isArray(entry) || entry.some((note) => typeof note !== 'string')) {
                fail(`${path}.notes`, 'must be an array of strings');
            }
        }
    }

    const assets = section(root.assets, 'assets', null);
    for (const [url, file] of Object.entries(assets)) {
        if (!url.startsWith('/')) fail(`assets.${url}`, 'must start with a slash');
        if (typeof file !== 'string' || !file) fail(`assets.${url}`, 'must be a file path');
    }

    return {
        name,
        port,
        packagesDir,
        clientIp: { header: header === null ? null : (header as string).toLowerCase(), trustProxy },
        manifest: { baseUrl, params, routes } as Config['manifest'],
        assets: assets as Record<string, string>,
    };
}
