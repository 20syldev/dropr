import type { Answer } from '../types/index.js';

// Request headers that a script may send to read a file in parts or only when it changed; the others need no listing
const ALLOWED = ['If-Match', 'If-Modified-Since', 'If-None-Match', 'If-Range', 'If-Unmodified-Since', 'Range'];

// Response headers that a script may read, besides the safelisted ones such as Content-Length and Last-Modified
const EXPOSED = [
    'Accept-Ranges',
    'Content-Disposition',
    'Content-Range',
    'Deprecation',
    'ETag',
    'Link',
    'X-Content-Type-Options',
];

// Headers of every answer: any origin may read it, with no credentials
export const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': EXPOSED.join(', '),
};

/**
 * Builds the answer to a CORS preflight, which every OPTIONS request gets.
 * The server reads only GET and HEAD, so those are the methods it allows, with the headers of ALLOWED; a browser keeps
 * the answer for a day, so a script that reads a file in ranges is not asked to preflight each part.
 *
 * @returns The 204 with the CORS headers of every answer, no body and no Content-Length, which a 204 must not carry
 */
export function preflight(): Answer {
    const headers = {
        ...CORS_HEADERS,
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': ALLOWED.join(', '),
        'Access-Control-Max-Age': '86400',
    };

    return { status: 204, headers, body: null };
}
