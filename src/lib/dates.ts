const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Reads a calendar day written YYYY-MM-DD, the only form of a release or deprecation date.
 * Every other spelling is refused, since Date.parse reads some of them in the time zone of the server, rolls an
 * impossible day over (2025-02-30) and gives dates that no header can carry.
 *
 * @param text - Candidate date, which must be exactly four, two and two digits joined by dashes
 * @returns The milliseconds since the epoch of 00:00:00 UTC of that day, or null when the text is not a real day
 */
export function parseDay(text: string): number | null {
    const match = DAY.exec(text);
    if (!match) return null;

    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const time = Date.UTC(year, month - 1, day);
    const date = new Date(time);

    // A year below 100 is read as 19xx by Date.UTC, and an impossible day rolls over to the next month
    const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

    return real && year >= 100 ? time : null;
}
