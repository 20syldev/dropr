export interface BarcodeOptions {
    data: string;
    type?: string;
    width?: number;
    height?: number;
    format?: string;
    color?: string;
    bg?: string;
}
export interface BarcodeResult {
    contentType: string;
    body: Buffer | string;
}
/**
 * Generates a barcode image in SVG or PNG format.
 *
 * @param options.data - Data to encode (required)
 * @param options.type - Barcode type: code128, ean13, ean8, upca, code39 (default: code128)
 * @param options.width - Bar unit width in px (1–5, default 2)
 * @param options.height - Bar height in px (50–300, default 100)
 * @param options.format - Output format: svg or png (default: svg)
 * @param options.color - Bar color hex (default: #000000)
 * @param options.bg - Background color hex (default: #ffffff)
 * @returns Object with contentType and body
 * @throws Error if data is missing, invalid for the type, or parameters are out of range
 */
export default function barcode(options: BarcodeOptions): BarcodeResult;
