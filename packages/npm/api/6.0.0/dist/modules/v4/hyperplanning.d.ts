interface CalendarEvent {
    summary: string[] | string;
    subject?: string;
    teacher?: string;
    classes?: string[];
    type?: string;
    start: string;
    end: string;
}
/**
 * Fetches and parses an ICS calendar from a Hyperplanning URL, filtering out past events.
 *
 * @param url - HTTPS URL to the ICS calendar
 * @param detail - Level of detail: "full" (subject/teacher/classes), "list" (summary/times), or default (summary only)
 * @returns Array of calendar events sorted by start time, excluding past events
 * @throws Error if the URL is invalid, uses HTTP, points to a private host, or does not return a valid ICS file
 */
export default function hyperplanning(url: string, detail?: string): Promise<CalendarEvent[]>;
export {};
