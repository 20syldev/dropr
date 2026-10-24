/**
 * Parses a hex color string into an RGB tuple.
 *
 * @param hex - Hex color string (#RRGGBB or RRGGBB)
 * @returns RGB tuple [r, g, b] with values 0-255
 * @throws Error if the hex string is invalid
 */
export declare function hexToRgb(hex: string): [number, number, number];
/**
 * Converts HSL values to an RGB tuple.
 *
 * @param h - Hue in degrees (0-360)
 * @param s - Saturation (0-1)
 * @param l - Lightness (0-1)
 * @returns RGB tuple [r, g, b] with values 0-255
 */
export declare function hslToRgb(h: number, s: number, l: number): [number, number, number];
/**
 * Validates and normalizes a hex color string, adding # if missing.
 *
 * @param value - Raw color value (with or without #)
 * @param def - Default color if value is empty
 * @returns Normalized hex color string with #
 * @throws Error if the color format is invalid
 */
export declare function normalizeColor(value: string | undefined, def: string): string;
/**
 * Formats an RGB tuple as a hex color string.
 *
 * @param r - Red channel (0-255)
 * @param g - Green channel (0-255)
 * @param b - Blue channel (0-255)
 * @returns Hex color string (#rrggbb)
 */
export declare function rgbToHex(r: number, g: number, b: number): string;
/**
 * Converts RGB values to an HSL tuple.
 *
 * @param r - Red channel (0-255)
 * @param g - Green channel (0-255)
 * @param b - Blue channel (0-255)
 * @returns HSL tuple [h (0-360), s (0-1), l (0-1)]
 */
export declare function rgbToHsl(r: number, g: number, b: number): [number, number, number];
