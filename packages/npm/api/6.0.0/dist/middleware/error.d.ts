import type { NextFunction, Request, Response } from 'express';
export declare function errorHandler(err: Error & {
    status?: number;
}, _req: Request, res: Response, _next: NextFunction): void;
