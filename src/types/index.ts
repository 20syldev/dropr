export interface Deprecation {
    date: string;
    message: string;
    successor: string;
}

export interface PackageProject {
    list: string;
    versions: Record<string, string>;
    deprecated?: Deprecation;
}

export interface PackageType {
    list: string;
    [project: string]: PackageProject | string;
}

export type Packages = Record<string, PackageType>;

export interface FileEntry {
    name: string;
    size: number | null;
    directory: boolean;
}

export interface SearchResult {
    type: string;
    name: string;
    versions: string[];
    url: string;
    deprecated?: Deprecation;
}

export type ChecksumMap = Record<string, string>;

export interface ErrorBody {
    status: number;
    error: string;
    message: string;
}

export interface ManifestParam {
    name: string;
    in: 'path' | 'query';
    required: boolean;
    description: string;
    example: string;
}

export interface ManifestRoute {
    id: string;
    group: 'packages' | 'files' | 'downloads' | 'discovery' | 'server';
    method: 'GET';
    path: string;
    title: string;
    summary: string;
    params: ManifestParam[];
    example: string;
    returns: 'json' | 'file' | 'archive' | 'html';
    notes: string[];
}

export interface Manifest {
    name: string;
    version: string;
    baseUrl: string;
    routes: ManifestRoute[];
}
