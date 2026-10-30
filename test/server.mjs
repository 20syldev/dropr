import { spawn } from 'child_process';
import crypto from 'crypto';
import http from 'http';
import net from 'net';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

let clients = 0;

/**
 * Finds a TCP port that is free on the loopback interface.
 *
 * @returns A port handed out by the system, free again once the probe server has closed
 */
function freePort() {
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
 * Starts the built server (dist/app.js) in a child process and waits until it listens.
 *
 * @param packagesDir - Packages tree passed as PACKAGES_DIR, the repository's packages/ by default, so a
 * PACKAGES_DIR exported in the shell never leaks in
 * @returns The port the server listens on, and stop() to kill it; rejects when the server exits or does not listen
 * within 10 seconds
 */
export async function startServer(packagesDir = join(rootDir, 'packages')) {
    const port = await freePort();
    const env = { ...process.env, PORT: String(port), PACKAGES_DIR: packagesDir };

    const child = spawn(process.execPath, [join(rootDir, 'dist', 'app.js')], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`The server did not listen within 10 seconds:\n${stderr}`));
        }, 10_000);

        // The listener stays attached, so the request log keeps draining and never blocks the server
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            if (!stdout.includes('is running')) return;

            clearTimeout(timer);
            resolve();
        });
        child.once('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`The server exited with code ${code}:\n${stderr}`));
        });
    });

    return { port, stop: () => child.kill() };
}

/**
 * Sends a raw HTTP request to a server started by startServer.
 * The path is sent as is, so '..' segments and percent escapes reach the server unchanged.
 *
 * @param port - Port returned by startServer
 * @param method - HTTP method, sent in upper case as given
 * @param path - Request target, never normalized nor encoded
 * @param headers - Extra request headers; a unique CF-Connecting-IP is added unless given, so the per-client rate
 * limit never trips across a whole test file
 * @returns Status, headers and body, with aborted true when the server cut the response before its end; rejects when
 * the connection fails before any response, or stays idle for 10 seconds
 */
export function request(port, method, path, headers = {}) {
    clients++;
    const client = `10.${(clients >> 16) & 255}.${(clients >> 8) & 255}.${clients & 255}`;

    return new Promise((resolve, reject) => {
        const options = { host: '127.0.0.1', port, method, path, agent: false, timeout: 10_000 };
        let started = false;
        const req = http.request({ ...options, headers: { 'cf-connecting-ip': client, ...headers } }, (res) => {
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
