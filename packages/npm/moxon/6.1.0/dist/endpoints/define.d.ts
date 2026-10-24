import type { Request } from 'express';
export type Category = 'security' | 'text' | 'images' | 'compute' | 'fakeData' | 'network' | 'realtime';
export interface Param {
    required?: boolean;
    missing?: string;
    options?: readonly string[];
    default?: string;
}
export type Values<P extends string> = Record<P, string | undefined>;
export interface Endpoint<P extends string = string> {
    name: string;
    method: 'get' | 'post';
    path: string;
    category: Category;
    since?: number;
    params: Record<P, Param>;
    example: Partial<Record<P, string>>;
    run(values: Values<P>, req: Request): unknown;
}
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
export declare function define<P extends string>(endpoint: Endpoint<P>): Endpoint<P>;
