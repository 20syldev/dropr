import { STATUS_CODES } from 'http';

import type { Response } from 'express';

import type { ErrorBody } from '../types/index.js';

/**
 * Builds the error body shared by every error response of the server.
 *
 * @param status - HTTP status code, kept numeric in the body
 * @param message - Human readable explanation of the error
 * @returns The error body, with the standard reason phrase of the status as error, 'Error' when it has none
 */
export function errorBody(status: number, message: string): ErrorBody {
    return { status, error: STATUS_CODES[status] ?? 'Error', message };
}

/**
 * Sends an error response with the unified JSON body.
 * It does not rely on res.jsonResponse, so it also works before that helper is
 * attached, e.g. from the error handler.
 *
 * @param res - Response whose headers are not sent yet, its status and Content-Type being set here
 * @param status - HTTP status code, also echoed in the body with its reason phrase
 * @param message - Human readable explanation of the error
 */
export function sendError(res: Response, status: number, message: string): void {
    res.status(status);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(errorBody(status, message), null, 2));
}
