import 'express-serve-static-core';

declare module 'express-serve-static-core' {
    interface Request {
        name: string;
        version: string;
        pinned: boolean;
    }
    interface Response {
        jsonResponse(data: unknown): void;
    }
}
