import * as apiv4 from '../modules/v4.js';
import * as apiv5 from '../modules/v5.js';
import * as apiv6 from '../modules/v6.js';
export interface Endpoint {
    name: string;
    path?: string;
    children?: Record<string, string>;
}
export interface VersionConfig {
    endpoints: {
        get: Endpoint[];
        post: Endpoint[];
        patch?: Endpoint[];
        delete?: Endpoint[];
    };
    modules: typeof apiv4 | typeof apiv5 | typeof apiv6;
}
export declare const versions: Record<string, VersionConfig>;
