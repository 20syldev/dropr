export function jsonResponseMiddleware(_req, res, next) {
    res.setHeader('Content-Type', 'application/json');
    res.jsonResponse = (data) => {
        res.send(JSON.stringify(data, null, 2));
    };
    next();
}
//# sourceMappingURL=json.js.map