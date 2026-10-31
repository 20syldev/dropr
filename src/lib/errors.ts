import type { Response } from 'express';

import type { ErrorBody } from '../types/index.js';

// Reason phrases of the error statuses the server answers itself; the adapter passes its own for any other
const REASONS: Record<number, string> = {
    400: 'Bad Request',
    404: 'Not Found',
    405: 'Method Not Allowed',
    412: 'Precondition Failed',
    416: 'Range Not Satisfiable',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
};

/**
 * Builds the error body shared by every error response of the server.
 *
 * @param status - HTTP error status, from 400 to 599, kept numeric in the body
 * @param message - Human readable explanation of the error
 * @param reason - Reason phrase of a status missing from the table, such as an error of the HTTP framework
 * @returns The error body, with the reason phrase of the status as error, 'Error' when none is known
 */
export function errorBody(status: number, message: string, reason = REASONS[status] ?? 'Error'): ErrorBody {
    return { status, error: reason, message };
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
