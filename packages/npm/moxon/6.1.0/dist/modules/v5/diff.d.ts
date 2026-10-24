export interface DiffChange {
    type: 'equal' | 'add' | 'del';
    value: string;
}
export interface DiffResult {
    mode: string;
    added: number;
    removed: number;
    changes: DiffChange[];
}
/**
 * Compares two texts and returns a structured diff using the LCS algorithm.
 *
 * @param a - Original text
 * @param b - Modified text
 * @param mode - Granularity: line (default) or word
 * @returns Diff result with the change list and added/removed counts
 * @throws Error if a text is missing or too long, or if the mode is invalid
 */
export default function diff(a: string, b: string, mode?: string): DiffResult;
