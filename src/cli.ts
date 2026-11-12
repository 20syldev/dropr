import { resolve } from 'path';
import { parseArgs } from 'util';

import { check } from './check.js';
import { emitIndex } from './indexer.js';
import { serve } from './serve.js';
import { choosePort, configure, readVersion } from './startup.js';

// Text of --help and of a usage error
const USAGE = `Usage: dropr <command> [config] [options]

Commands:
    serve [config]    Index the packages and serve them
    check [config]    Check the config and the packages, without listening
    index [config]    Print the index of the packages as JSON, or write it with --out

Options:
    --port <port>         Port to listen on (serve), before the PORT variable and the config
    --packages <folder>   Packages folder, before the one of the config
    --out <file>          File to write the index to (index), the standard output otherwise
    --index <file>        Index to serve (serve), written by dropr index, instead of scanning the packages
    -h, --help            Show this help
    -v, --version         Show the version

The config is dropr.config.json of the working folder when none is named, and defaults stand in when there is none.`;

/**
 * What the command line reaches of its surroundings, so that a test can give its own.
 */
export interface Context {
    env: Record<string, string | undefined>;
    cwd: string;
    out: (text: string) => void;
    err: (text: string) => void;
}

/**
 * Finds what a command line asks for that its command does not take.
 *
 * @param command - Command that was named
 * @param files - How many config files were named
 * @param values - Options that were given
 * @returns The message of the first fault, null when the command takes everything it was given
 */
function findMisuse(
    command: string,
    files: number,
    values: { port?: string; out?: string; index?: string },
): string | null {
    if (files > 1) return 'Only one config file can be named.';
    if (command !== 'serve' && values.port !== undefined) return '--port belongs to serve.';
    if (command !== 'index' && values.out !== undefined) return '--out belongs to index.';
    if (command !== 'serve' && values.index !== undefined) return '--index belongs to serve.';

    return null;
}

/**
 * Runs the command line of dropr.
 * A server keeps the process alive after this settles, so the code that comes back is the one of the start.
 *
 * @param argv - Arguments after the program name
 * @param context - Env, working folder and the two outputs
 * @returns 0 when the command ran or the server listens, 1 for a config, a folder or a port that fails, 2 for a command
 * line that is not understood
 */
export async function main(argv: string[], context: Context): Promise<number> {
    const { env, cwd, out, err } = context;
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                port: { type: 'string' },
                packages: { type: 'string' },
                out: { type: 'string' },
                index: { type: 'string' },
                help: { type: 'boolean', short: 'h' },
                version: { type: 'boolean', short: 'v' },
            },
        });
    } catch (error) {
        err(`${(error as Error).message}\n\n${USAGE}`);

        return 2;
    }

    const { values, positionals } = parsed;
    const [command, ...rest] = positionals;
    if (values.help || values.version) {
        out(values.help ? USAGE : readVersion());

        return 0;
    }

    if (command !== 'serve' && command !== 'check' && command !== 'index') {
        err(`${command ? `Unknown command '${command}'.` : 'A command is needed.'}\n\n${USAGE}`);

        return 2;
    }
    const misuse = findMisuse(command, rest.length, values);
    if (misuse !== null) {
        err(`${misuse}\n\n${USAGE}`);

        return 2;
    }

    try {
        if (values.out === '') throw new Error('--out must not be empty.');
        if (values.index === '') throw new Error('--index must not be empty.');

        const { config, file } = configure(rest[0], cwd, values.packages, choosePort(values.port, env.PORT));
        if (command === 'check') return check(config, file, out, err);
        if (command === 'index') {
            return emitIndex(config, values.out === undefined ? null : resolve(cwd, values.out), out, err);
        }

        await serve(config, readVersion(), out, values.index === undefined ? null : resolve(cwd, values.index));

        return 0;
    } catch (error) {
        err((error as Error).message);

        return 1;
    }
}
