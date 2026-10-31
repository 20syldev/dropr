import fs from 'fs';
import { dirname, resolve } from 'path';

import { parseConfig } from './lib/config.js';
import type { Config } from './types/index.js';

/**
 * Reads a config file, validates it and resolves its paths against the folder of the file.
 *
 * @param file - Path of the JSON file
 * @returns The config, its packagesDir and asset files absolute; throws when the file cannot be read, is not JSON or
 * is refused by parseConfig
 */
export function loadConfig(file: string): Config {
    let text: string;
    try {
        text = fs.readFileSync(file, 'utf-8');
    } catch (error) {
        throw new Error(`Invalid config: ${file} cannot be read (${(error as Error).message})`, { cause: error });
    }

    let input: unknown;
    try {
        input = JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid config: ${file} is not valid JSON (${(error as Error).message})`, { cause: error });
    }

    const base = dirname(resolve(file));
    const config = parseConfig(input);

    return {
        ...config,
        packagesDir: resolve(base, config.packagesDir),
        assets: Object.fromEntries(Object.entries(config.assets).map(([url, path]) => [url, resolve(base, path)])),
    };
}
