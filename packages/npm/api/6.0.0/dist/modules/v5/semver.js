import { MAX_SEMVER_LENGTH } from '../../constants.js';
const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const ACTIONS = ['parse', 'bump', 'compare'];
const PARTS = ['major', 'minor', 'patch'];
function parse(version) {
    if (version.length > MAX_SEMVER_LENGTH) {
        throw new Error(`Version must be ${MAX_SEMVER_LENGTH} characters or fewer`);
    }
    const match = SEMVER_REGEX.exec(version);
    if (!match)
        throw new Error('Invalid semver version');
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
        prerelease: match[4] ?? null,
        build: match[5] ?? null,
    };
}
function comparePrerelease(a, b) {
    if (a === null && b === null)
        return 0;
    if (a === null)
        return 1;
    if (b === null)
        return -1;
    const left = a.split('.');
    const right = b.split('.');
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const x = left[i];
        const y = right[i];
        if (x === undefined)
            return -1;
        if (y === undefined)
            return 1;
        const xNumeric = /^\d+$/.test(x);
        const yNumeric = /^\d+$/.test(y);
        if (xNumeric && yNumeric) {
            if (parseInt(x, 10) !== parseInt(y, 10))
                return parseInt(x, 10) < parseInt(y, 10) ? -1 : 1;
        }
        else if (xNumeric) {
            return -1;
        }
        else if (yNumeric) {
            return 1;
        }
        else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    return 0;
}
function compare(a, b) {
    if (a.major !== b.major)
        return a.major < b.major ? -1 : 1;
    if (a.minor !== b.minor)
        return a.minor < b.minor ? -1 : 1;
    if (a.patch !== b.patch)
        return a.patch < b.patch ? -1 : 1;
    const prerelease = comparePrerelease(a.prerelease, b.prerelease);
    return prerelease < 0 ? -1 : prerelease > 0 ? 1 : 0;
}
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
export default function semver(version, action = 'parse', part = 'patch', other) {
    if (!version)
        throw new Error('Please provide a version (?version={version})');
    if (!ACTIONS.includes(action))
        throw new Error(`Action must be one of: ${ACTIONS.join(', ')}`);
    const parsed = parse(version);
    if (action === 'parse') {
        return { version, ...parsed };
    }
    if (action === 'bump') {
        if (!PARTS.includes(part))
            throw new Error(`Part must be one of: ${PARTS.join(', ')}`);
        const result = part === 'major'
            ? `${parsed.major + 1}.0.0`
            : part === 'minor'
                ? `${parsed.major}.${parsed.minor + 1}.0`
                : `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
        return { version, action: 'bump', part, result };
    }
    if (!other)
        throw new Error('Please provide a second version (&other={version})');
    const result = compare(parsed, parse(other));
    const sign = result === 0 ? '=' : result < 0 ? '<' : '>';
    return { version, action: 'compare', other, result, description: `${version} ${sign} ${other}` };
}
//# sourceMappingURL=semver.js.map