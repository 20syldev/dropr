import type { Category, Param } from './endpoints/define.js';
export interface ManifestEntry {
    name: string;
    method: 'get' | 'post';
    path: string;
    category: Category;
    since?: number;
    params: Record<string, Param>;
    example: Record<string, string>;
}
export declare const manifest: ManifestEntry[];
