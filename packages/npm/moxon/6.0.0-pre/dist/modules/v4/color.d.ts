export interface ColorResult {
    hex: string;
    rgb: string;
    hsl: string;
    hsv: string;
    hwb: string;
    cmyk: string;
}
/**
 * Converts a hex color to all major color space representations, or generates a random color.
 *
 * @param hex - Optional hex color string (e.g. "#ff5733"); generates a random color if omitted
 * @returns Color in hex, RGB, HSL, HSV, HWB, and CMYK formats
 * @throws Error if the hex string is invalid
 */
export default function color(hex?: string): ColorResult;
