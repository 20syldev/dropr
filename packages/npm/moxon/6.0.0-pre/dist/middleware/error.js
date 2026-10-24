import { error } from '../utils/response.js';
export function errorHandler(err, _req, res, _next) {
    console.error(err.stack);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    const sensitive = status === 500 && /\/[a-z]|\\[a-z]|ECONNREFUSED|ENOENT|EPERM|at\s+\w/i.test(err.message);
    error(res, status, sensitive ? 'An unexpected error occurred.' : err.message);
}
//# sourceMappingURL=error.js.map