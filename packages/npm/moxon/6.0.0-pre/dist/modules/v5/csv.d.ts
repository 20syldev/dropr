export interface CsvParseResult {
    action: 'parse';
    rows: Record<string, string>[];
    count: number;
}
export interface CsvFormatResult {
    action: 'format';
    csv: string;
    count: number;
}
export type CsvResult = CsvParseResult | CsvFormatResult;
/**
 * Converts between CSV and JSON.
 * - `parse`: CSV string → array of objects
 * - `format`: array of objects → CSV string
 *
 * @param action - "parse" or "format"
 * @param data - Input payload: `csv` string for parse, `json` array of objects for format
 * @param options - `delimiter` (single character, default ",") and `headers` (parse only: use the first row as keys, default true)
 * @returns Parse result with the rows and their count, or format result with the CSV string and the row count
 * @throws Error if the action is invalid, the delimiter is not a single character, the input data is missing, or a size limit is exceeded
 */
export default function csv(action: string, data: {
    csv?: string;
    json?: Record<string, unknown>[];
}, options?: {
    delimiter?: string;
    headers?: boolean;
}): CsvResult;
