export interface Deprecation {
    date: string;
    message: string;
    successor: string;
}

export interface FileEntry {
    name: string;
    size: number;
    directory: boolean;
}

export interface SearchResult {
    type: string;
    name: string;
    versions: string[];
    url: string;
    deprecated?: Deprecation;
}

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
    format: 2;
    types: IndexType[];
}

export interface IndexType {
    name: string;
    projects: IndexProject[];
}

export interface IndexProject {
    name: string;
    deprecated?: Deprecation;
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
    entries: IndexNode[];
}

export interface IndexFile {
    kind: 'file';
    name: string;
    size: number;
    exec: boolean;
    sha256: string;
}

export interface IndexLink {
    kind: 'link';
    name: string;
    target: string;
    real?: string;
}

export interface CatalogDir {
    kind: 'dir';
    name: string;
    size: number;
    entries: CatalogNode[];
}

export type CatalogNode = CatalogDir | IndexFile | IndexLink;

export interface CatalogVersion {
    type: string;
    project: string;
    name: string;
    date: string;
    released: number;
    root: CatalogDir;
    nodes: Map<string, CatalogNode>;
}

export interface CatalogProject {
    name: string;
    deprecated?: Deprecation;
    versions: Map<string, CatalogVersion>;
    latest: CatalogVersion;
}

export interface CatalogType {
    name: string;
    projects: Map<string, CatalogProject>;
}

export interface Catalog {
    types: Map<string, CatalogType>;
}

export interface Resolved {
    node: CatalogDir | IndexFile;
    path: string;
}

export type RouteInput = Pick<Request, 'method' | 'url' | 'headers'>;

export type Match =
    | { id: 'root' }
    | { id: 'search' }
    | { id: 'health' }
    | { id: 'manifest' }
    | { id: 'docs'; page: string | null }
    | { id: 'downloads' }
    | { id: 'typeDownloads'; type: string }
    | { id: 'archive'; type: string; name: string; version: string | null }
    | { id: 'type'; type: string }
    | { id: 'versions'; type: string; name: string }
    | { id: 'changelog'; type: string; name: string }
    | { id: 'version'; type: string; name: string; version: string }
    | { id: 'file'; type: string; name: string; version: string; path: string; slash: boolean }
    | { id: 'beneath'; type: string; name: string }
    | { id: 'encoding' }
    | { id: 'unknown' };

export interface JsonBody {
    kind: 'json';
    text: string;
}

export interface EmptyBody {
    kind: 'empty';
}

export interface ByteRange {
    start: number;
    end: number;
}

export interface FileBody {
    kind: 'file';
    path: string;
    range: ByteRange | null;
    missing: RouteResponse;
}

export interface ArchiveBody {
    kind: 'archive';
    key: string;
    entries: TarEntry[];
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

export type ReadFile = (path: string, range?: ByteRange) => Promise<ReadableStream<Uint8Array<ArrayBuffer>>>;

export interface Validators {
    etag: string;
    lastModified: number;
    size: number;
}

export interface Conditions {
    method: string;
    ifMatch: string | null;
    ifNoneMatch: string | null;
    ifModifiedSince: string | null;
    ifUnmodifiedSince: string | null;
    ifRange: string | null;
    range: string | null;
}

export interface Decision {
    status: 200 | 206 | 304 | 412 | 416;
    headers: Record<string, string>;
    range: ByteRange | null;
}

export interface Asset extends Validators {
    contentType: string;
    open(range?: ByteRange): Promise<ReadableStream<Uint8Array<ArrayBuffer>>>;
}

export interface Memory {
    rss: number;
    heapUsed: number;
    heapTotal: number;
}

export interface Site {
    health(): Record<string, unknown>;
    manifest: Manifest;
}

export interface Answer {
    status: number;
    headers: Record<string, string>;
    body: string | ReadableStream<Uint8Array<ArrayBuffer>> | null;
}

export interface UiSettings {
    accent: string | null;
    logo: string | null;
    favicon: string | null;
    docs: boolean;
}

export interface Guide {
    slug: string;
    title: string;
    markdown: string;
}

export type UiInput =
    boolean | { accent?: string | null; logo?: string | null; favicon?: string | null; docs?: boolean };

export interface ResponderOptions {
    catalog: Catalog;
    name: string;
    version: string;
    manifest: Manifest;
    read: ReadFile;
    assets: Record<string, Asset>;
    clientHeader: string | null;
    rateLimit: RateLimit;
    memory?: () => Memory;
    logger: ErrorLogger;
    ui?: UiInput;
}

export type Respond = (request: RouteInput, client: string) => Promise<Answer>;

export type Handler = (request: RouteInput, client?: string) => Promise<Response>;

export interface RateLimit {
    window: number;
    client: number;
    global: number | null;
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
    clientIp: { header: string | null };
    rateLimit: RateLimit;
    manifest: ManifestConfig;
    assets: Record<string, string>;
    ui: UiSettings | false;
}

export interface AppDeps {
    index: Index;
    packagesDir: string;
    version: string;
    logger: Logger;
    read?: ReadFile;
    assets?: Record<string, Asset>;
}
