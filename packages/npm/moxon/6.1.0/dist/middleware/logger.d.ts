import type { NextFunction, Request, Response } from 'express';
export declare const logger: import("@20syldev/logger.ts").Logger;
/**
 * Masks an identifier carried in the path, leaving the named sub-routes visible.
 *
 * @param path - Request path, without its query string
 * @returns The path, with a trailing identifier segment masked
 */
export declare function redactPath(path: string): string;
/**
 * Strips query string values from a URL, keeping the path and parameter names.
 *
 * GET endpoints carry user input in the query string — text passed to /encode,
 * card numbers and IBANs passed to /validate, URLs passed to /qrcode — and the
 * log buffer is readable over /logs. Names alone keep the trace useful for
 * debugging without retaining anybody's payload.
 *
 * Names are kept percent-encoded on purpose. Decoding them would let a caller
 * write raw newlines and ANSI escapes into the operator's terminal and into the
 * /logs buffer, and would expose the theme's {placeholder} syntax.
 *
 * @param originalUrl - Request URL, with or without a query string
 * @returns The path, followed by the parameter names when the URL had any
 */
export declare function redactQuery(originalUrl: string): string;
export declare function loggerMiddleware(req: Request, res: Response, next: NextFunction): void;
