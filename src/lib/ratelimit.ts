import type { NextFunction, Request, Response } from 'express';

import { sendError } from './errors.js';

const WINDOW = 10_000;
const GLOBAL_LIMIT = 1000;
const CLIENT_LIMIT = 100;

const hits = new Map<string, number[]>();

let requests = 0;
let resetTime = Date.now() + WINDOW;

setInterval(() => {
    // Drop clients that went quiet, so the map does not grow unbounded
    const now = Date.now();
    for (const [ip, times] of hits) {
        const recent = times.filter((time) => now - time < WINDOW);
        if (recent.length === 0) hits.delete(ip);
        else hits.set(ip, recent);
    }
}, WINDOW).unref();

/**
 * Identifies the client behind the reverse proxies.
 * The proxy rewrites CF-Connecting-IP on every request, so it cannot be
 * spoofed by the client, unlike the leftmost X-Forwarded-For entry.
 *
 * @param req - Request read for its CF-Connecting-IP header, then req.ip and the socket address as fallbacks
 * @returns The client address, or an empty string if unknown
 */
function getClient(req: Request): string {
    const header = req.headers['cf-connecting-ip'];
    if (typeof header === 'string' && header.length > 0) return header;

    return req.ip || req.socket.remoteAddress || '';
}

/**
 * Limits requests globally over a fixed window and per client over a sliding window.
 * The global cap protects the server, the per-client cap keeps a single
 * noisy client from consuming it and locking everyone else out.
 *
 * @param req - Request whose client, as identified by getClient, is counted against the per-client cap
 * @param res - Receives a 429 error when the global or the per-client cap is exceeded
 * @param next - Called only when the request stays within both caps
 */
export function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();

    if (now > resetTime) {
        requests = 0;
        resetTime = now + WINDOW;
    }
    if (++requests > GLOBAL_LIMIT) {
        sendError(res, 429, 'Global rate limit exceeded.');
        return;
    }

    const client = getClient(req);
    const recent = (hits.get(client) ?? []).filter((time) => now - time < WINDOW);
    recent.push(now);
    hits.set(client, recent);

    if (recent.length > CLIENT_LIMIT) {
        sendError(res, 429, `You have exceeded the limit of ${CLIENT_LIMIT} requests per ${WINDOW / 1000} seconds.`);
        return;
    }

    next();
}
