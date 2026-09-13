export declare const VALID_TIMEZONES: readonly ["UTC", "America/New_York", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney"];
/**
 * Returns the current or a random date/time in various formats and timezones,
 * or computes a countdown/elapsed time to/from a target date.
 *
 * @param type - "live" for the current time, "random" for a random date, or "countdown" for a time diff
 * @param start - Optional start date for random mode (YYYY-MM-DD)
 * @param end - Optional end date for random mode (YYYY-MM-DD)
 * @param format - Optional specific format to return (e.g. "iso", "timestamp", "year")
 * @param timezone - Optional timezone (e.g. "UTC", "Europe/Paris")
 * @param target - Required for countdown mode: target date in ISO 8601 or YYYY-MM-DD format
 * @returns Object containing all time formats, a single format, or a countdown result
 * @throws Error if type, format, timezone, or target is invalid
 */
export default function time(type?: string, start?: string, end?: string, format?: string, timezone?: string, target?: string): Record<string, unknown>;
