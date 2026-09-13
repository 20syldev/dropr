export interface AvatarOptions {
    seed?: string;
    size?: number;
    type?: string;
    bg?: string;
    format?: string;
}
export interface AvatarResult {
    contentType: string;
    body: Buffer | string;
}
/**
 * Generates a deterministic identicon or pixel-art avatar from a seed string.
 *
 * @param options.seed - Seed string (default: random UUID)
 * @param options.size - Output size in px (50–500, default 200)
 * @param options.type - Avatar style: identicon or pixel (default: identicon)
 * @param options.bg - Background hex color (default: #f0f0f0)
 * @param options.format - Output format: png or svg (default: png)
 * @returns Object with contentType and body (Buffer for PNG, string for SVG)
 * @throws Error if type, format, or size is invalid
 */
export default function avatar(options?: AvatarOptions): AvatarResult;
