import assert from 'assert/strict';
import { describe, test } from 'node:test';

import { CORS_HEADERS, preflight } from '../dist/lib/cors.js';

describe('CORS headers', () => {
    test('let any origin read an answer, with no credentials', () => {
        assert.equal(CORS_HEADERS['Access-Control-Allow-Origin'], '*');
        assert.equal(CORS_HEADERS['Access-Control-Allow-Credentials'], undefined);
    });

    test('expose the headers a script needs to read a file in parts or to follow a deprecation', () => {
        const exposed = CORS_HEADERS['Access-Control-Expose-Headers'].split(', ');

        assert.deepEqual(exposed, [
            'Accept-Ranges',
            'Content-Disposition',
            'Content-Range',
            'Deprecation',
            'ETag',
            'Link',
            'X-Content-Type-Options',
        ]);
    });
});

describe('preflight', () => {
    test('is a 204 with no body and no length, which a 204 must not carry', () => {
        const answer = preflight();

        assert.equal(answer.status, 204);
        assert.equal(answer.body, null);
        assert.equal(
            Object.keys(answer.headers).some((name) => name.toLowerCase() === 'content-length'),
            false,
        );
    });

    test('allows the two methods the server reads and the headers of conditions and ranges [change: cors]', () => {
        const { headers } = preflight();

        assert.equal(headers['Access-Control-Allow-Methods'], 'GET, HEAD');
        assert.equal(
            headers['Access-Control-Allow-Headers'],
            'If-Match, If-Modified-Since, If-None-Match, If-Range, If-Unmodified-Since, Range',
        );
        assert.equal(headers['Access-Control-Max-Age'], '86400');
        assert.equal(headers['Access-Control-Allow-Origin'], '*');
        assert.equal(headers['Access-Control-Expose-Headers'], CORS_HEADERS['Access-Control-Expose-Headers']);
    });

    test('is the same answer every time and shares nothing between calls', () => {
        const first = preflight();
        first.headers['Access-Control-Allow-Origin'] = 'https://evil.example';

        assert.equal(preflight().headers['Access-Control-Allow-Origin'], '*');
        assert.equal(CORS_HEADERS['Access-Control-Allow-Origin'], '*');
    });
});
