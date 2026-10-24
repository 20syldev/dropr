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
