import type { NextFunction, Request, Response } from 'express';

import type { Limiter } from '../types/index.js';

import { sendError } from './errors.js';

const WINDOW = 10_000;
const GLOBAL_LIMIT = 1000;
const CLIENT_LIMIT = 100;

const limiter = createLimiter(Date.now());

/**
 * Drops the timestamps that left the window, and the clients left with none, so the map does not grow unbounded.
 * Every check filters the timestamps of its client again, so a sweep frees memory but never changes a decision.
 *
 * @param hits - Request timestamps per client, pruned in place
 * @param now - Current time in milliseconds, timestamps WINDOW old or older being dropped
 */
function sweep(hits: Map<string, number[]>, now: number): void {
    for (const [client, times] of hits) {
        const recent = times.filter((time) => now - time < WINDOW);
        if (recent.length === 0) hits.delete(client);
        else hits.set(client, recent);
    }
}

/**
 * Creates a limiter of requests, capped globally over a fixed window and per client over a sliding window.
 * The global cap protects the server, the per-client cap keeps a single noisy client from consuming it and locking
 * everyone else out. Old timestamps are swept on the checks themselves, so no timer runs.
 *
 * @param start - Creation time in milliseconds, which opens the first global window and the first sweep period
 * @returns A limiter whose counters belong to it alone; check gives the 429 message of a refused request, null when
 * the request stays within both caps, a request refused by the per-client cap still counting against its client
 */
export function createLimiter(start: number): Limiter {
    const hits = new Map<string, number[]>();
    let requests = 0;
    let resetTime = start + WINDOW;
    let sweepTime = start + WINDOW;

    return {
        get size() {
            return hits.size;
        },
        check(client, now) {
            if (now >= sweepTime) {
                sweep(hits, now);
                sweepTime = now + WINDOW;
            }
            if (now > resetTime) {
                requests = 0;
                resetTime = now + WINDOW;
            }
            if (++requests > GLOBAL_LIMIT) return 'Global rate limit exceeded.';

            const recent = (hits.get(client) ?? []).filter((time) => now - time < WINDOW);
            recent.push(now);
            hits.set(client, recent);

            if (recent.length > CLIENT_LIMIT) {
                return `You have exceeded the limit of ${CLIENT_LIMIT} requests per ${WINDOW / 1000} seconds.`;
            }

            return null;
        },
    };
}

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
 * The counters live in one limiter, created when the module loads and shared by every request of the process.
 *
 * @param req - Request whose client, as identified by getClient, is counted against the per-client cap
 * @param res - Receives a 429 error when the global or the per-client cap is exceeded
 * @param next - Called only when the request stays within both caps
 */
export function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const refusal = limiter.check(getClient(req), Date.now());
    if (refusal) return sendError(res, 429, refusal);

    next();
}
