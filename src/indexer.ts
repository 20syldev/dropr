import fs from 'fs';
import { dirname, isAbsolute, relative, sep } from 'path';

import { reservedNames } from './config.js';
import { readableFolder } from './folder.js';
import { countPackages, loadIndex } from './lib/packages.js';
import { scan } from './scan.js';
import type { Config } from './types/index.js';

/**
 * Scans the packages folder of a config and prints its index as JSON, so that a host without a disk can serve it.
 * The text is read back through loadIndex before anything is printed, so an index that the core could not serve is
 * never written. What a server would skip is reported to err and left out of the index, as serve does.
 *
 * @param config - Validated config, its paths absolute
 * @param target - Absolute path of the file to write, its folders made when missing; null to print the index
 * @param out - Receives the index when target is null, otherwise a line that says what was written
 * @param err - Receives the problems, among them the entries that a server would skip
 * @returns 0 when the index was printed or written, 1 when the packages folder is not a folder or cannot be read
 * @throws Error when target is inside the packages folder, where the next scan would index it, when the index is refused
 * by loadIndex or when the file cannot be written
 */
export function emitIndex(
    config: Config,
    target: string | null,
    out: (text: string) => void,
    err: (text: string) => void,
): number {
    if (target !== null) {
        const inside = relative(config.packagesDir, target);
        if (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) {
            throw new Error('--out must not be inside the packages folder.');
        }
    }
    if (!readableFolder(config.packagesDir, err)) return 1;

    const logger = { error: (...args: unknown[]) => err(args.map(String).join(' ')) };
    const text = JSON.stringify(scan(config.packagesDir, logger, reservedNames(config)));
    const catalog = loadIndex(JSON.parse(text));

    if (target === null) {
        out(text);

        return 0;
    }

    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, `${text}\n`);
    out(`Indexed ${countPackages(catalog)} packages from ${config.packagesDir} into ${target}.`);

    return 0;
}
