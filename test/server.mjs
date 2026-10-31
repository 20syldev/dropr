import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import net from 'net';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { createApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';
import { scan } from '../dist/scan.js';

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Config of the repository, with its own client header so the rate limit of the tests never depends on the instance
export const config = {
    ...loadConfig(join(rootDir, 'dropr.config.json')),
    clientIp: { header: 'x-test-client', trustProxy: true },
};

// Version of dropr, which /health and /manifest report
export const { version } = JSON.parse(fs.readFileSync(join(rootDir, 'package.json'), 'utf-8'));

let clients = 0;

/**
 * Finds a TCP port that is free on the loopback interface.
 *
 * @returns A port handed out by the system, free again once the probe server has closed
 */
export function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

/**
 * Serves an app on a free loopback port.
 *
 * @param app - App from createApp, or any request listener
 * @returns The port, and stop() which closes the server and its connections
 */
export async function listen(app) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    return {
        port: server.address().port,
        stop: () => new Promise((resolve) => (server.close(resolve), server.closeAllConnections())),
    };
}

/**
 * Starts the app of the repository config in process, on a packages tree of the test.
 *
 * @param packagesDir - Packages tree, the repository's packages/ by default
 * @param change - Config keys that replace the ones of the repository config
 * @returns The port, stop(), and what the app logged in requests and errors, the scan messages included
 */
export async function startServer(packagesDir = config.packagesDir, change = {}) {
    const logs = { requests: [], errors: [] };
    const logger = { request: (entry) => logs.requests.push(entry), error: (...args) => logs.errors.push(args) };
    const app = createApp({ ...config, ...change }, { index: scan(packagesDir, logger), packagesDir, version, logger });

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
export function request(port, method, path, headers = {}) {
    clients++;
    const client = `10.${(clients >> 16) & 255}.${(clients >> 8) & 255}.${clients & 255}`;
    const identity = config.clientIp.header ? { [config.clientIp.header]: client } : {};

    return new Promise((resolve, reject) => {
        const options = { host: '127.0.0.1', port, method, path, agent: false, timeout: 10_000 };
        let started = false;
        const req = http.request({ ...options, headers: { ...identity, ...headers } }, (res) => {
            started = true;
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('error', () => {});
            res.on('close', () =>
                resolve({
                    status: res.statusCode,
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
export function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}
