import type { NextFunction, Request, Response } from 'express';
export declare function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void;
