import { versions } from '../config/versions.js';
import { error } from '../utils/response.js';
export function versionCheckMiddleware(req, res, next) {
    const version = req.params.version;
    const latest = Object.keys(versions).pop();
    req.version = version;
    req.latest = latest;
    if (!versions[version]) {
        error(res, 404, `Invalid API version (${version}).`);
        return;
    }
    req.module = versions[version].modules;
    if (!req.module) {
        error(res, 404, `Module not found for version ${version}.`);
        return;
    }
    next();
}
export function endpointCheckMiddleware(req, res, next) {
    const version = req.params.version;
    const endpoint = req.params.endpoint;
    req.version = version;
    req.endpoint = endpoint;
    if (!endpoint) {
        error(res, 404, `Endpoint '${endpoint}' does not exist in ${req.version}.`);
        return;
    }
    next();
}
//# sourceMappingURL=version.js.map