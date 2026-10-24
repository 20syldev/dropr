export interface StatisticsResult {
    count: number;
    sum: number;
    min: number;
    max: number;
    range: number;
    mean: number;
    median: number;
    mode: number[];
    variance: number;
    stddev: number;
}
/**
 * Computes descriptive statistics for a comma-separated list of numbers.
 *
 * @param values - Comma-separated numeric string (e.g. "1,2,3,4,5")
 * @returns Object containing count, sum, min, max, range, mean, median, mode, variance, and standard deviation
 * @throws Error if values is missing, contains non-numeric entries, or exceeds the maximum count
 */
export default function statistics(values: string): StatisticsResult;
