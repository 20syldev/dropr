/**
 * Writes text so that it can stand in HTML content or in a quoted attribute.
 *
 * @param text - Any text
 * @returns The text with & < > " and ' written as numeric entities
 */
export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (mark) => `&#${mark.charCodeAt(0)};`);
}

/**
 * Percent-encodes a segment of an address, a name with a lone surrogate included.
 *
 * @param text - Name of a type, a project, a version or a file
 * @returns The segment encoded as UTF-8, each lone surrogate being written as U+FFFD instead of throwing
 */
export function encodeSegment(text: string): string {
    return encodeURIComponent(
        text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd'),
    );
}
