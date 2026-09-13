import type { Response } from 'express';
/**
 * Sends a standardized JSON error response.
 *
 * @param res - Express response object
 * @param status - HTTP status code
 * @param message - Error description
 */
export declare function error(res: Response, status: number, message: string): void;
