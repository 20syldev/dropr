import fs from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { loadConfig } from './config.js';
import { parseConfig } from './lib/config.js';
import type { Config } from './types/index.js';

// Name of the config file that is looked for in the working folder when none is named
export const CONFIG_FILE = 'dropr.config.json';

// Port of a server whose config does not set one
const DEFAULT_PORT = 4000;

/**
 * Reads a port from the text of an option or of the env.
 *
 * @param text - Text to read
 * @param label - Where the text comes from, for the message
 * @returns The integer from 1 to 65535
 * @throws Error when the text is not such an integer
 */
function parsePort(text: string, label: string): number {
    const port = Number(text);
    if (!/^\d+$/.test(text) || port < 1 || port > 65535) {
        throw new Error(`${label} must be an integer from 1 to 65535, not '${text}'.`);
    }

    return port;
}

/**
 * Chooses the port to listen on among the ones that the command gives: the option, then the PORT of the env.
 *
 * @param flag - Value of --port, undefined when absent
 * @param env - Value of the PORT variable, undefined or empty when absent
 * @returns The port, undefined when neither is given, which leaves the one of the config
 * @throws Error when the option or the variable is not a port
 */
export function choosePort(flag: string | undefined, env: string | undefined): number | undefined {
    if (flag !== undefined) return parsePort(flag, '--port');
    if (env) return parsePort(env, 'PORT');

    return undefined;
}

/**
 * Loads the config of a command, whose folder is the working one.
 * A named file must exist. Without one, the dropr.config.json of the working folder is read when there is one, and the
 * defaults stand in otherwise: port 4000, a packages folder next to the command and a base URL on the port.
 *
 * @param file - Config file named on the command line, relative to the working folder; undefined when none
 * @param cwd - Working folder, which the default config file and the paths of a default config are relative to
 * @param packages - Value of --packages, relative to the working folder; undefined keeps the one of the config
 * @param port - Port chosen by choosePort(), undefined to keep the one of the config
 * @returns The config, its paths absolute, and the file it came from, null for the defaults
 * @throws Error when --packages is empty, or the config cannot be read or is invalid, its message starting with
 * "Invalid config:"
 */
export function configure(
    file: string | undefined,
    cwd: string,
    packages: string | undefined,
    port: number | undefined,
): { config: Config; file: string | null } {
    if (packages === '') throw new Error('--packages must not be empty.');

    const named = file === undefined ? join(cwd, CONFIG_FILE) : resolve(cwd, file);
    const found = file !== undefined || fs.lstatSync(named, { throwIfNoEntry: false }) !== undefined;

    let config: Config;
    if (found) {
        config = loadConfig(named);
    } else {
        const base = `http://localhost:${port ?? DEFAULT_PORT}`;
        config = { ...parseConfig({ manifest: { baseUrl: base } }), packagesDir: resolve(cwd, 'packages') };
    }

    if (packages !== undefined) config.packagesDir = resolve(cwd, packages);
    if (port !== undefined) config.port = port;

    return { config, file: found ? named : null };
}

/**
 * Reads the version of dropr from the package.json that ships with this code.
 *
 * @returns The version, such as 4.0.0
 */
export function readVersion(): string {
    const manifest = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

    return JSON.parse(fs.readFileSync(manifest, 'utf-8')).version;
}
