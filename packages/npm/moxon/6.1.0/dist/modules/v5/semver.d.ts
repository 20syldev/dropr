export interface SemverParseResult {
    version: string;
    major: number;
    minor: number;
    patch: number;
    prerelease: string | null;
    build: string | null;
}
export interface SemverBumpResult {
    version: string;
    action: 'bump';
    part: string;
    result: string;
}
export interface SemverCompareResult {
    version: string;
    action: 'compare';
    other: string;
    result: -1 | 0 | 1;
    description: string;
}
export type SemverResult = SemverParseResult | SemverBumpResult | SemverCompareResult;
/**
 * Parses, bumps or compares semantic versions (semver.org).
 *
 * @param version - The semver version to work with
 * @param action - Action to perform: parse (default), bump or compare
 * @param part - For bump: part to increment (major, minor or patch), lower parts reset to zero
 * @param other - For compare: second version to compare against
 * @returns Parsed components, the bumped version, or the comparison result (-1, 0 or 1)
 * @throws Error if a version is missing, too long or invalid, or if action/part is unknown
 */
export default function semver(version: string, action?: string, part?: string, other?: string): SemverResult;
