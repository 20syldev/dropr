export interface CronResult {
    expression: string;
    description: string;
    next: string[];
    timezone: string;
}
/**
 * Parses a cron expression and returns the next scheduled execution dates.
 *
 * @param expr - Cron expression with 5 space-separated fields (minute hour dom month dow)
 * @param count - Number of next executions to return (1–20, default 5)
 * @param from - Starting date in ISO 8601 format (defaults to now)
 * @param timezone - Timezone to evaluate the expression in (default "UTC")
 * @returns Parsed expression with description and list of next execution timestamps
 * @throws Error if the expression is invalid, count is out of range, or timezone is unsupported
 */
export default function cron(expr: string, count?: number, from?: string, timezone?: string): CronResult;
