import fs from 'fs';

import { scanAssets } from './assets.js';
import { reservedNames } from './config.js';
import { countPackages, loadIndex } from './lib/packages.js';
import { scan } from './scan.js';
import type { Config } from './types/index.js';

/**
 * Checks that a config can start a server, without listening.
 * The packages and the assets are scanned as a server would, and whatever it would skip is reported.
 *
 * @param config - Validated config, its paths absolute
 * @param file - File the config came from, null for the defaults
 * @param out - Receives the report
 * @param err - Receives the problems, among them the entries that a server would skip
 * @returns 0 when the config is sound, 1 when the packages folder is not a folder; skipped entries only warn
 */
export function check(
    config: Config,
    file: string | null,
    out: (text: string) => void,
    err: (text: string) => void,
): number {
    let skipped = 0;
    const logger = {
        error: (...args: unknown[]) => {
            skipped++;
            err(args.map(String).join(' '));
        },
    };

    out(`Config: ${file ?? 'defaults, no dropr.config.json in the working folder'}`);
    if (!fs.existsSync(config.packagesDir) || !fs.statSync(config.packagesDir).isDirectory()) {
        err(`Packages folder ${config.packagesDir} is not a folder.`);

        return 1;
    }

    const catalog = loadIndex(scan(config.packagesDir, logger, reservedNames(config)));
    const assets = Object.keys(scanAssets(config.assets, logger));

    out(`Name: ${config.name}, port ${config.port}`);
    out(`Packages: ${countPackages(catalog)} in ${config.packagesDir}`);
    out(`Assets: ${assets.length} of ${Object.keys(config.assets).length}`);
    out(skipped === 0 ? 'Nothing to report.' : `${skipped} problems reported above, whose entries a server skips.`);

    return 0;
}
