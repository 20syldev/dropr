export interface PaletteColor {
    hex: string;
    rgb: string;
    hsl: string;
}
export interface PaletteResult {
    base: PaletteColor;
    type: string;
    colors: PaletteColor[];
}
/**
 * Generates a color palette from a base hex color using a specified harmony type.
 *
 * @param color - Base hex color (e.g. "#ff5733")
 * @param type - Palette type: "complementary", "triadic", "analogous", "tetradic", or "split-complementary"
 * @returns Object containing the base color and the derived palette colors in hex, RGB, and HSL
 * @throws Error if color or type is missing, or the type is not one of the accepted values
 */
export default function palette(color: string, type: string): PaletteResult;
