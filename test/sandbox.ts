import fs from 'fs';
import { builtinModules } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import vm from 'vm';

import type * as Core from '../dist/core.js';
import { scan } from '../dist/scan.js';
import type { Handler, ResponderOptions } from '../dist/types/index.js';

import { createFixture } from './fixture.ts';
import { memoryPort } from './port.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMITER = fileURLToPath(import.meta.resolve('@moxon/limiter'));
const FILE = '/npm/lib@1.2.0/index.js';
const ADDRESS = '10.0.0.1';

/**
 * The headers of a response that a test reads, null when the response lacks one.
 */
export interface SandboxHeaders {
    'content-type': string | null;
    'content-length': string | null;
    etag: string | null;
    'content-range': string | null;
    'retry-after': string | null;
    allow: string | null;
}

/**
 * What the helper keeps of a response: status, the headers a test reads, and the body as base64.
 */
export interface SandboxAnswer {
    status: number;
    headers: SandboxHeaders;
    body: string;
}

/**
 * The answers of the handler built inside the context, by request.
 */
export interface SandboxAnswers {
    health: SandboxAnswer;
    listing: SandboxAnswer;
    search: SandboxAnswer;
    manifest: SandboxAnswer;
    file: SandboxAnswer;
    range: SandboxAnswer;
    conditional: SandboxAnswer;
    head: SandboxAnswer;
    preflight: SandboxAnswer;
    archive: SandboxAnswer;
    absent: SandboxAnswer;
    limited: SandboxAnswer;
}

/**
 * What the run mode prints: the Node globals the context has, and the answers.
 */
export interface SandboxRun {
    missing: string[];
    answers: SandboxAnswers;
}

/**
 * What the reject mode prints: the message of the loading error, or null when every file loaded.
 */
export interface SandboxRejection {
    error: string | null;
}

/**
 * The context of a sandbox, and the cache of the modules read for it.
 */
export interface SandboxState {
    context: vm.Context;
    cache: Map<string, vm.SourceTextModule>;
}

// The only globals a fetch runtime is certain to give a module, taken from this realm
const WEB_GLOBALS: string[] = [
    'CompressionStream',
    'Headers',
    'ReadableStream',
    'Request',
    'Response',
    'TextDecoder',
    'TextEncoder',
    'TransformStream',
    'URL',
    'URLSearchParams',
    'WritableStream',
];

/**
 * Tells whether a module specifier names something that only Node provides.
 *
 * @param specifier - Specifier of an import, as written in the module
 * @returns True for a node: specifier and for the name of a built-in module, with or without a subpath
 */
function isNode(specifier: string): boolean {
    return specifier.startsWith('node:') || builtinModules.includes(specifier.split('/')[0]);
}

/**
 * Makes a context whose global object holds the web globals and nothing of Node.
 *
 * @returns The context, whose Object, Array, Promise and Error are its own
 */
function makeContext(): vm.Context {
    const sandbox = Object.fromEntries(
        WEB_GLOBALS.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
    );

    return vm.createContext(sandbox);
}

/**
 * Reads a file as a module of a context, once.
 *
 * @param state - The context, and the cache of the modules read for it
 * @param file - Absolute path of a JavaScript module
 * @returns The module, not yet linked
 */
function readModule(state: SandboxState, file: string): vm.SourceTextModule {
    if (!state.cache.has(file)) {
        const source = fs.readFileSync(file, 'utf-8');
        const identifier = pathToFileURL(file).href;
        state.cache.set(file, new vm.SourceTextModule(source, { context: state.context, identifier }));
    }

    return state.cache.get(file)!;
}

/**
 * Builds the function that resolves the imports of a module graph, linking only what a fetch runtime could resolve.
 *
 * @param state - The context, and the cache of the modules read for it
 * @returns A linker that throws for a Node module and for any package but the limiter
 */
function makeLinker(state: SandboxState): (specifier: string, referencing: vm.Module) => Promise<vm.Module> {
    return async (specifier, referencing) => {
        const from = fileURLToPath(referencing.identifier);
        if (isNode(specifier)) throw new Error(`${from} imports ${specifier}, a module of Node`);
        if (specifier === '@moxon/limiter') return readModule(state, LIMITER);
        if (specifier.startsWith('.')) return readModule(state, resolve(dirname(from), specifier));

        throw new Error(`${from} imports ${specifier}, which a fetch runtime does not resolve`);
    };
}

/**
 * Loads a file and everything it imports into a context, then evaluates it.
 *
 * @param state - The context, and the cache of the modules read for it
 * @param file - Absolute path of a JavaScript module
 * @returns The namespace of the module, whose exports are values of the context
 */
async function load(state: SandboxState, file: string): Promise<object> {
    const loaded = readModule(state, file);
    if (loaded.status === 'unlinked') await loaded.link(makeLinker(state));
    if (loaded.status === 'linked') await loaded.evaluate();

    return loaded.namespace;
}

/**
 * Answers a request through a handler and keeps what a test needs to see of the response.
 *
 * @param handler - Fetch handler under test
 * @param path - Request target on http://localhost
 * @param init - Method and headers of the request
 * @param address - Address of the client, the same one by default so that the rate limit sees one client
 * @returns Status, the headers a test reads, and the body as base64
 */
async function ask(
    handler: Handler,
    path: string,
    init: RequestInit = {},
    address: string = ADDRESS,
): Promise<SandboxAnswer> {
    const response = await handler(new Request(`http://localhost${path}`, init), address);
    const names = ['content-type', 'content-length', 'etag', 'content-range', 'retry-after', 'allow'];
    const headers = Object.fromEntries(
        names.map((name) => [name, response.headers.get(name)]),
    ) as unknown as SandboxHeaders;
    const body = Buffer.from(await response.arrayBuffer()).toString('base64');

    return { status: response.status, headers, body };
}

/**
 * Runs the requests of the sandbox test through the handler of a context that holds no Node API.
 *
 * @param entries - Files of dist/ whose exports build the handler
 * @returns What the requests answered, and what the context lacks
 */
async function run(entries: string[]): Promise<SandboxRun> {
    const state: SandboxState = { context: makeContext(), cache: new Map() };
    const core: typeof Core = Object.assign(
        {},
        ...(await Promise.all(entries.map((file) => load(state, resolve(ROOT, file))))),
    );
    const missing: string[] = vm.runInContext(
        "['process', 'Buffer', 'setTimeout', 'require'].filter((name) => typeof globalThis[name] !== 'undefined')",
        state.context,
    );
    const fixture = createFixture();

    try {
        const index = JSON.stringify(scan(fixture.packagesDir, { error() {} }));
        const parse: typeof JSON.parse = vm.runInContext('JSON.parse', state.context);
        const options: ResponderOptions = {
            catalog: core.loadIndex(parse(index)),
            name: 'dropr',
            version: '9.9.9',
            manifest: core.buildManifest(
                { baseUrl: 'https://cdn.example.com', params: {}, routes: {} },
                'dropr',
                '9.9.9',
            ),
            read: memoryPort((path: string) => fs.readFileSync(join(fixture.packagesDir, path))),
            assets: {},
            clientHeader: null,
            rateLimit: { window: 10, client: 100, global: 1000 },
            logger: { error() {} },
        };
        const handler = core.createHandler(options);
        const first = await ask(handler, FILE);
        const answers = {
            health: await ask(handler, '/health'),
            listing: await ask(handler, '/'),
            search: await ask(handler, '/search?q=lib'),
            manifest: await ask(handler, '/manifest'),
            file: first,
            range: await ask(handler, FILE, { headers: { range: 'bytes=0-5' } }),
            conditional: await ask(handler, FILE, { headers: { 'if-none-match': String(first.headers.etag) } }),
            head: await ask(handler, FILE, { method: 'HEAD' }),
            preflight: await ask(handler, '/npm', { method: 'OPTIONS' }),
            archive: await ask(handler, '/download/npm/lib@1.2.0'),
            absent: await ask(
                core.createHandler({ ...options, read: async () => Promise.reject(new Error('gone')) }),
                FILE,
            ),
        };
        const strict = core.createHandler({ ...options, rateLimit: { window: 10, client: 2, global: null } });
        for (let count = 0; count < 2; count++) await ask(strict, '/health');
        const limited = await ask(strict, '/health');

        return { missing, answers: { ...answers, limited } };
    } finally {
        fixture.remove();
    }
}

/**
 * Tries to load files of dist/ into the context and reports whether the loader refuses them.
 *
 * @param entries - Files of dist/ to load
 * @returns The message of the error that loading raised, or null when every file loaded
 */
async function attempt(entries: string[]): Promise<string | null> {
    const state: SandboxState = { context: makeContext(), cache: new Map() };

    try {
        for (const file of entries) await load(state, resolve(ROOT, file));

        return null;
    } catch (error) {
        return (error as Error).message;
    }
}

const [mode, ...entries] = process.argv.slice(2);
const result: SandboxRun | SandboxRejection = mode === 'run' ? await run(entries) : { error: await attempt(entries) };

process.stdout.write(JSON.stringify(result));
