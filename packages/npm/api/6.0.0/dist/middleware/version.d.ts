import type { NextFunction, Request, Response } from 'express';
export declare function versionCheckMiddleware(req: Request, res: Response, next: NextFunction): void;
export declare function endpointCheckMiddleware(req: Request, res: Response, next: NextFunction): void;
