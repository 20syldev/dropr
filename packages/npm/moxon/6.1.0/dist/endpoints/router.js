import { Router } from 'express';
import { since } from '../utils/helpers.js';
import { error } from '../utils/response.js';
/**
 * Builds the HTTP routes of the declared endpoints, with the required parameter check and the shared error format.
 * A POST-only endpoint also answers GET with a 405, and a version older than its `since` answers 404.
 *
 * @param endpoints - Contracts to serve, each mounted under `/:version`
 * @returns Router to mount before the hand-written routes, so a declared endpoint takes precedence
 */
export function build(endpoints) {
    const router = Router();
    for (const endpoint of endpoints) {
        const path = `/:version${endpoint.path}`;
        const served = (req) => !endpoint.since || since(req.version, endpoint.since);
        router[endpoint.method](path, async (req, res) => {
            if (!served(req)) {
                error(res, 404, `Endpoint not available in ${req.version}.`);
                return;
            }
            const source = ((endpoint.method === 'get' ? req.query : req.body) ?? {});
            const values = {};
            for (const [name, param] of Object.entries(endpoint.params)) {
                const value = source[name];
                if (param.required && !value) {
                    error(res, 400, param.missing ?? `Please provide a ${name}`);
                    return;
                }
                values[name] = value;
            }
            try {
                res.jsonResponse(await endpoint.run(values, req));
            }
            catch (err) {
                error(res, 400, err.message);
            }
        });
        if (endpoint.method === 'post') {
            router.get(path, (req, res) => {
                if (!served(req)) {
                    error(res, 404, `Endpoint not available in ${req.version}.`);
                    return;
                }
                error(res, 405, 'This endpoint only supports POST requests.');
            });
        }
    }
    return router;
}
//# sourceMappingURL=router.js.map