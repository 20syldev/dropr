import fs from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { createLogger } from '@20syldev/logger.ts';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { scan } from './scan.js';
import type { Logger } from './types/index.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Starts the server: reads the config file and the env, indexes the packages, then listens.
 * The config file is the first argument, dropr.config.json at the repository root by default; PORT and PACKAGES_DIR
 * win over its port and packagesDir, and a config that cannot be loaded sets the exit code to 1.
 */
function serve(): void {
    let config;
    try {
        config = loadConfig(resolve(process.argv[2] ?? join(rootDir, 'dropr.config.json')));
    } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
        return;
    }

    const colored = createLogger({ theme: 'colored', order: 'desc' });
    const logger: Logger = {
        request: ({ method, url, status, duration }) =>
            void colored.log({ method, url, status, duration: `${duration}ms` }),
        error: (...args) => console.error(...args),
    };

    // PACKAGES_DIR serves another tree than the configured one, as the tests do with a generated one
    if (process.env.PACKAGES_DIR) config.packagesDir = resolve(process.env.PACKAGES_DIR);
    const port = Number(process.env.PORT ?? config.port);
    const pkg = JSON.parse(fs.readFileSync(join(rootDir, 'package.json'), 'utf-8'));
    const { packagesDir } = config;
    const app = createApp(config, { index: scan(packagesDir, logger), packagesDir, version: pkg.version, logger });

    // Express 5 hands a listen failure (port taken) to this callback, so it must not report the server as running
    app.listen(port, (error) => {
        if (error) throw error;

        console.log(`${config.name} is running on\n    - http://127.0.0.1:${port}\n    - http://localhost:${port}`);
    });
}

serve();
