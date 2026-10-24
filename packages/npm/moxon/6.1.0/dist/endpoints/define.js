/**
 * Declares an endpoint contract and infers its parameter names, so `run` receives typed values.
 * The HTTP router and the documentation manifest are both built from it, so the two cannot drift apart.
 *
 * @param endpoint - Contract of the route: `since` is the first API version serving it (all of them when
 * omitted), `params` are read from the query string on GET and from the JSON body on POST, `example` is the
 * input the documentation runs to show a real output, and an error thrown by `run` becomes a 400 carrying its
 * message
 * @returns The same contract, typed with its parameter names
 */
export function define(endpoint) {
    return endpoint;
}
//# sourceMappingURL=define.js.map