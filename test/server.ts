import crypto from 'crypto';
import type { BinaryLike } from 'crypto';
import fs from 'fs';
import http from 'http';
import type { IncomingHttpHeaders, RequestListener } from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { createApp } from '../dist/app.js';
import { scanAssets } from '../dist/assets.js';
import { parseConfig } from '../dist/lib/config.js';
import { scan } from '../dist/scan.js';
import type { AppDeps, Config, Logger, UiSettings } from '../dist/types/index.js';

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Config of the tests: its own client header, a base URL that names no real host, two small icons as assets
export const config = parseConfig({
    packagesDir: join(rootDir, 'packages'),
    clientIp: { header: 'x-test-client' },
    manifest: { baseUrl: 'https://cdn.example.com' },
    assets: {
        '/favicon.ico': join(rootDir, 'test', 'assets', 'icon.ico'),
        '/favicon.svg': join(rootDir, 'test', 'assets', 'icon.svg'),
    },
});

// Pages in their default look, for the tests that turn the pages on
export const PAGES: UiSettings = { accent: null, logo: null, favicon: null, docs: false };

// Version of dropr, which /health and /manifest report
export const { version } = JSON.parse(fs.readFileSync(join(rootDir, 'package.json'), 'utf-8')) as { version: string };

/**
 * A server started in process, as handed out by listen() and startServer().
 */
export interface Listening {
    port: number;
    stop: () => Promise<void>;
}

/**
 * One request as the app logs it.
 */
export type RequestLog = Parameters<Logger['request']>[0];

/**
 * What the app logged: each request, and the arguments of each error.
 */
export interface ServerLogs {
    requests: RequestLog[];
    errors: unknown[][];
}

/**
 * A server started by startServer, with what its app logged.
 */
export interface TestServer extends Listening {
    logs: ServerLogs;
}

/**
 * A response read by request(), aborted being true when the server cut it before its end.
 */
export interface Reply {
    status: number;
    headers: IncomingHttpHeaders;
    body: Buffer;
    aborted: boolean;
}

let clients = 0;

/**
 * Finds a TCP port that is free on the loopback interface.
 *
 * @returns A port handed out by the system, free again once the probe server has closed
 */
export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address() as AddressInfo;
            probe.close(() => resolve(port));
        });
    });
}

/**
 * Serves an app on a free loopback port.
 *
 * @param app - Listener from createApp, or any request listener
 * @returns The port, and stop() which closes the server and its connections
 */
export async function listen(app: RequestListener): Promise<Listening> {
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return {
        port: (server.address() as AddressInfo).port,
        stop: () => new Promise<void>((resolve) => (server.close(() => resolve()), server.closeAllConnections())),
    };
}

/**
 * Starts the app of the test config in process, on a packages tree of the test.
 *
 * @param packagesDir - Packages tree, a packages/ folder that does not exist by default
 * @param change - Config keys that replace the ones of the test config
 * @param deps - Dependencies of createApp that replace the default ones, such as a read port
 * @returns The port, stop(), and what the app logged in requests and errors, the scan messages included
 */
export async function startServer(
    packagesDir: string = config.packagesDir,
    change: Partial<Config> = {},
    deps: Partial<AppDeps> = {},
): Promise<TestServer> {
    const logs: ServerLogs = { requests: [], errors: [] };
    const logger: Logger = {
        request: (entry) => void logs.requests.push(entry),
        error: (...args) => void logs.errors.push(args),
    };
    const index = scan(packagesDir, logger);
    const settings = { ...config, ...change };
    const assets = scanAssets(settings.assets, logger);
    const app = createApp(settings, { index, packagesDir, version, logger, assets, ...deps });

    return { ...(await listen(app)), logs };
}

/**
 * Sends a raw HTTP request to a server started by startServer.
 * The path is sent as is, so '..' segments and percent escapes reach the server unchanged.
 *
 * @param port - Port returned by startServer
 * @param method - HTTP method, sent in upper case as given
 * @param path - Request target, never normalized nor encoded
 * @param headers - Extra request headers; a unique client IP header is added unless given, so the per-client rate
 * limit never trips across a whole test file
 * @returns Status, headers and body, with aborted true when the server cut the response before its end; rejects when
 * the connection fails before any response, or stays idle for 10 seconds
 */
export function request(
    port: number,
    method: string,
    path: string,
    headers: Record<string, string> = {},
): Promise<Reply> {
    clients++;
    const client = `10.${(clients >> 16) & 255}.${(clients >> 8) & 255}.${clients & 255}`;
    const identity = config.clientIp.header ? { [config.clientIp.header]: client } : {};

    return new Promise((resolve, reject) => {
        const options = { host: '127.0.0.1', port, method, path, agent: false, timeout: 10_000 };
        let started = false;
        const req = http.request({ ...options, headers: { ...identity, ...headers } }, (res) => {
            started = true;
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('error', () => {});
            res.on('close', () =>
                resolve({
                    status: res.statusCode as number,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                    aborted: !res.complete,
                }),
            );
        });
        req.on('error', (error) => {
            // Once the response has started, a reset is the server cutting it short, reported by its close event
            if (!started) reject(error);
        });
        req.on('timeout', () => req.destroy(new Error(`No answer to ${method} ${path} within 10 seconds`)));
        req.end();
    });
}

/**
 * Hashes a buffer with SHA-256, the algorithm of the ?checksums route.
 *
 * @param data - Bytes to hash, such as a file body or an archive entry
 * @returns The lowercase hex digest
 */
export function sha256(data: BinaryLike): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}
