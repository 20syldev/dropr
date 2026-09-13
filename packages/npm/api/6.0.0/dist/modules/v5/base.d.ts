export interface BaseResult {
    value: string;
    from: number;
    to: number;
    result: string;
}
/**
 * Converts a number between numeric bases (2-36) with arbitrary precision.
 *
 * @param value - The value to convert, optionally prefixed with a minus sign
 * @param from - Input base (default 10)
 * @param to - Output base (default 16)
 * @returns Object with the original value, both bases and the lowercase result
 * @throws Error if the value is missing, too long or invalid for the input base, or if a base is out of range
 */
export default function base(value: string, from?: number, to?: number): BaseResult;
