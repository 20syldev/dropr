import ical from 'ical.js';
import { formatDate } from '../../utils/helpers.js';
function blocked(hostname) {
    const list = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'metadata.google.internal'];
    if (list.includes(hostname))
        return true;
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        if (parts[0] === 10)
            return true;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
            return true;
        if (parts[0] === 192 && parts[1] === 168)
            return true;
        if (parts[0] === 169 && parts[1] === 254)
            return true;
        if (parts[0] === 0)
            return true;
    }
    return false;
}
/**
 * Fetches and parses an ICS calendar from a Hyperplanning URL, filtering out past events.
 *
 * @param url - HTTPS URL to the ICS calendar
 * @param detail - Level of detail: "full" (subject/teacher/classes), "list" (summary/times), or default (summary only)
 * @returns Array of calendar events sorted by start time, excluding past events
 * @throws Error if the URL is invalid, uses HTTP, points to a private host, or does not return a valid ICS file
 */
export default async function hyperplanning(url, detail) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error('Invalid URL.');
    }
    if (parsed.protocol !== 'https:')
        throw new Error('Only HTTPS URLs are allowed.');
    if (blocked(parsed.hostname))
        throw new Error('Access to private/internal hosts is not allowed.');
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('text/calendar')) {
        throw new Error('Invalid ICS file format.');
    }
    const events = new ical.Component(ical.parse(await response.text()))
        .getAllSubcomponents('vevent')
        .map((e) => {
        const evt = new ical.Event(e);
        const summary = (evt.summary || '').split(' ').filter((part) => part !== '-');
        const start = formatDate(evt.startDate.toJSDate());
        const end = formatDate(evt.endDate.toJSDate());
        if (detail === 'full') {
            const desc = (evt.description || '').split('\n').map((l) => l.trim());
            const extract = (p) => (desc.find((l) => l.startsWith(p)) || '').replace(p, '').trim();
            return {
                summary,
                subject: extract('Matière :'),
                teacher: extract('Enseignant :'),
                classes: extract('Promotions :')
                    .split(', ')
                    .map((c) => c.trim()),
                type: extract('Salle :') || undefined,
                start,
                end,
            };
        }
        if (detail === 'list')
            return { summary, start, end };
        return {
            summary: evt.summary || '',
            start,
            end,
        };
    })
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
        .filter((e) => new Date(e.end) >= new Date());
    return events;
}
//# sourceMappingURL=hyperplanning.js.map