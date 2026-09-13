export type ChartOutput = {
    contentType: 'image/svg+xml';
    body: string;
} | {
    contentType: 'application/json';
    body: Record<string, unknown>;
};
interface ChartOptions {
    title?: unknown;
    width?: unknown;
    height?: unknown;
    colors?: unknown;
    bg?: unknown;
    legend?: unknown;
    mode?: unknown;
}
/**
 * Renders a bar chart as SVG or returns its raw data.
 *
 * @param data - Chart data with labels and one or more datasets (each with a name and values array)
 * @param options - Chart options: title, width, height, colors, bg, legend (default true), mode ("svg" or "data")
 * @returns ChartOutput with contentType image/svg+xml (SVG string) or application/json (raw data) depending on mode
 * @throws Error if data is missing, malformed, or exceeds the maximum number of labels or datasets
 */
export declare function bar(data: unknown, options: ChartOptions): ChartOutput;
/**
 * Renders a line chart as SVG or returns its raw data.
 *
 * @param data - Chart data with labels and one or more datasets (each with a name and values array)
 * @param options - Chart options: title, width, height, colors, bg, legend (default true), mode ("svg" or "data")
 * @returns ChartOutput with contentType image/svg+xml (SVG string) or application/json (raw data) depending on mode
 * @throws Error if data is missing, malformed, or exceeds the maximum number of labels or datasets
 */
export declare function line(data: unknown, options: ChartOptions): ChartOutput;
/**
 * Renders a pie chart as SVG or returns its raw data.
 *
 * @param data - Chart data with labels and a single dataset (each with a name and values array)
 * @param options - Chart options: title, width, height, colors, bg, legend (default true), mode ("svg" or "data")
 * @returns ChartOutput with contentType image/svg+xml (SVG string) or application/json (raw data) depending on mode
 * @throws Error if data is missing, malformed, or exceeds the maximum number of labels or datasets
 */
export declare function pie(data: unknown, options: ChartOptions): ChartOutput;
/**
 * Renders a donut chart as SVG or returns its raw data.
 *
 * @param data - Chart data with labels and a single dataset (each with a name and values array)
 * @param options - Chart options: title, width, height, colors, bg, legend (default true), mode ("svg" or "data")
 * @returns ChartOutput with contentType image/svg+xml (SVG string) or application/json (raw data) depending on mode
 * @throws Error if data is missing, malformed, or exceeds the maximum number of labels or datasets
 */
export declare function donut(data: unknown, options: ChartOptions): ChartOutput;
export {};
