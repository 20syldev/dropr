export interface UuidGenerateResult {
    uuid: string;
    version: number;
    variant: string;
}
export interface UuidGenerateBatchResult {
    uuids: string[];
    count: number;
}
export interface UuidParseResult {
    uuid: string;
    version: number | null;
    variant: string | null;
    valid: boolean;
}
export type UuidResult = UuidGenerateResult | UuidGenerateBatchResult | UuidParseResult;
/**
 * Generates random UUID v4 values or parses an existing UUID.
 *
 * @param input - UUID to parse; when omitted, a random UUID v4 is generated
 * @param count - Number of UUIDs to generate (1-50), ignored when input is provided
 * @returns Parsed components, a single generated UUID, or a batch of generated UUIDs
 * @throws Error if count is not a number or out of range
 */
export default function uuid(input?: string, count?: number): UuidResult;
