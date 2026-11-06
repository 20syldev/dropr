import http from 'http';

import { createLogger } from '@20syldev/logger.ts';

import { createApp } from './app.js';
import { scanAssets } from './assets.js';
import { reservedNames } from './config.js';
import { scan } from './scan.js';
import type { Config, Logger } from './types/index.js';

/**
 * Starts the server of a config: indexes the packages and the assets, then listens.
 * A failure to listen (port taken) is emitted by the server, not thrown, so it is rethrown instead of letting the
 * banner report a server that is not running.
 *
 * @param config - Validated config, its paths absolute and its port the one to listen on
 * @param version - Version of dropr, which /health and /manifest report
 * @param out - Receives the banner once the server listens
 * @returns The server, which keeps the process alive
 */
export function serve(config: Config, version: string, out: (text: string) => void): http.Server {
    const colored = createLogger({ theme: 'colored', order: 'desc' });
    const logger: Logger = {
        request: ({ method, url, status, duration }) =>
            void colored.log({ method, url, status, duration: `${duration}ms` }),
        error: (...args) => console.error(...args),
    };

    const { packagesDir, port } = config;
    const index = scan(packagesDir, logger, reservedNames(config));
    const assets = scanAssets(config.assets, logger);
    const server = http.createServer(createApp(config, { index, packagesDir, version, logger, assets }));

    server.on('error', (error) => {
        throw error;
    });
    server.listen(port, () => {
        out(`${config.name} is running on\n    - http://127.0.0.1:${port}\n    - http://localhost:${port}`);
    });

    return server;
}
