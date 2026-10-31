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

export interface ParamSpec {
    key: string;
    in: 'path' | 'query';
    required: boolean;
}

export interface RouteSpec {
    id: string;
    group: 'packages' | 'files' | 'downloads' | 'discovery' | 'server';
    method: 'GET';
    path: string;
    params: ParamSpec[];
    returns: 'json' | 'file' | 'archive' | 'html';
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

export interface Index {
    format: 1;
    types: IndexType[];
}

export interface IndexType {
    name: string;
    projects: IndexProject[];
}

export interface IndexProject {
    name: string;
    deprecated: Deprecation | null;
    versions: IndexVersion[];
}

export interface IndexVersion {
    name: string;
    date: string;
    root: IndexDir;
}

export type IndexNode = IndexDir | IndexFile | IndexLink;

export interface IndexDir {
    kind: 'dir';
    name: string;
    size: number | null;
    entries: IndexNode[] | null;
}

export interface IndexFile {
    kind: 'file';
    name: string;
    mtime: number;
    size: number;
    exec: boolean;
    sha256: string | null;
}

export interface IndexLink {
    kind: 'link';
    name: string;
    target: string;
    real: string | null;
}

export interface CatalogVersion {
    type: string;
    project: string;
    name: string;
    date: string;
    root: IndexDir;
    nodes: Map<string, IndexNode>;
}

export interface Catalog {
    packages: Packages;
    versions: Map<string, CatalogVersion>;
}

export interface Resolved {
    node: IndexDir | IndexFile;
    path: string;
    hops: number;
}

export type Query = Readonly<Record<string, unknown>>;

export type RequestHeaders = Readonly<Record<string, string | string[] | undefined>>;

export interface RouteRequest {
    method: string;
    target: string;
    path: string;
    query: Query;
    headers: RequestHeaders;
}

export interface JsonBody {
    kind: 'json';
    text: string;
}

export interface EmptyBody {
    kind: 'empty';
}

export interface FileBody {
    kind: 'file';
    path: string;
    size: number;
    mtime: number;
    missing: string;
    precondition: string;
    range: string;
}

export interface ArchiveBody {
    kind: 'archive';
    key: string;
    entries: TarEntry[] | null;
}

export type RouteBody = JsonBody | EmptyBody | FileBody | ArchiveBody;

export interface RouteResponse {
    status: number;
    headers: Record<string, string>;
    body: RouteBody;
}

export interface TarEntry {
    kind: 'dir' | 'file' | 'link';
    path: string;
    mode: number;
    mtime: number;
    size: number;
    target: string | null;
    source: string | null;
}

export type TarRead = (source: string) => Promise<Uint8Array<ArrayBuffer>>;

export interface Limiter {
    readonly size: number;
    check(client: string, now: number): string | null;
}

export interface Logger {
    request(entry: { method: string; url: string; status: number; duration: number }): void;
    error(...args: unknown[]): void;
}

export type ErrorLogger = Pick<Logger, 'error'>;

export type ParamText = Pick<ManifestParam, 'name' | 'description' | 'example'>;

export type RouteText = Pick<ManifestRoute, 'title' | 'summary' | 'example' | 'notes'>;

export interface ManifestConfig {
    baseUrl: string;
    params: Record<string, Partial<ParamText>>;
    routes: Record<string, Partial<RouteText>>;
}

export interface Config {
    name: string;
    port: number;
    packagesDir: string;
    clientIp: { header: string | null; trustProxy: boolean };
    manifest: ManifestConfig;
    assets: Record<string, string>;
}

export interface AppDeps {
    index: Index;
    packagesDir: string;
    version: string;
    logger: Logger;
}
