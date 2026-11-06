import type { ErrorBody } from '../types/index.js';

// Reason phrases of the error statuses the server answers itself
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
 * @returns The error body, with the reason phrase of the status as error, 'Error' when none is known
 */
export function errorBody(status: number, message: string): ErrorBody {
    return { status, error: REASONS[status] ?? 'Error', message };
}
