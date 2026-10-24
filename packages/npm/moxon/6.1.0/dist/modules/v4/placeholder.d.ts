type AvatarShape = 'circle' | 'rounded' | 'square';
type AnimateMode = 'shimmer' | 'pulse' | 'none';
export interface PlaceholderOptions {
    width: number;
    height: number;
    bg?: string;
    color?: string;
    text?: string;
    rows?: number;
    avatar?: AvatarShape;
    lines?: number;
    animate?: AnimateMode;
    speed?: number;
    radius?: number;
}
export interface PlaceholderResult {
    type: string;
    contentType: string;
    body: string;
}
/**
 * Generates an SVG placeholder image or skeleton loader with configurable dimensions and style.
 *
 * @param type - Placeholder type: "image" or "skeleton"
 * @param query - Query parameters including width, height, bg, color, text, rows, avatar, animate, speed, and radius
 * @returns Object containing the SVG body, content type, and placeholder type
 * @throws Error if any parameter is invalid or out of range
 */
export default function placeholder(type: string, query: Record<string, string | undefined>): PlaceholderResult;
export {};
