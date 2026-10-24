import { createCanvas, loadImage } from 'canvas';
import { toBuffer, toCanvas as qrToCanvas, toDataURL } from 'qrcode';
import { MAX_QRCODE_LOGO_BYTES } from '../../constants.js';
import { normalizeColor } from '../../utils/colors.js';
const CORRECTIONS = new Set(['L', 'M', 'Q', 'H']);
const FORMATS = new Set(['png', 'base64']);
function clamp(value, name, def, min, max) {
    if (value === undefined)
        return def;
    if (isNaN(value))
        throw new Error(`${name} must be a number`);
    if (value < min || value > max)
        throw new Error(`${name} must be between ${min} and ${max}`);
    return Math.floor(value);
}
async function fetchIcon(url) {
    if (!/^https:\/\//i.test(url))
        throw new Error('Icon URL must use HTTPS');
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok)
        throw new Error(`Failed to fetch icon: HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/'))
        throw new Error('Icon URL must point to an image');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_QRCODE_LOGO_BYTES)
        throw new Error('Icon must be under 2MB');
    return buffer;
}
/**
 * Generates a QR code image for a given URL, with optional icon overlay and color customization.
 *
 * @param options - QR code generation options including URL, size, margin, correction level, colors, and optional icon
 * @returns Object containing the QR code as a PNG buffer or Base64 string, and the content type
 * @throws Error if the URL is missing, any option is invalid, or the icon URL cannot be fetched
 */
export default async function qrcode(options) {
    const { url } = options;
    if (!url || typeof url !== 'string')
        throw new Error('Please provide a valid URL');
    const format = options.format ?? 'png';
    if (!FORMATS.has(format))
        throw new Error('Format must be one of: png, base64');
    const size = clamp(options.size, 'size', 200, 50, 2000);
    const margin = clamp(options.margin, 'margin', 4, 0, 10);
    const dark = normalizeColor(options.dark, '#000000');
    const light = normalizeColor(options.light, '#ffffff');
    let correction = options.correction ?? 'M';
    if (!CORRECTIONS.has(correction))
        throw new Error('Correction must be one of: L, M, Q, H');
    if (options.icon)
        correction = 'H';
    const qrOpts = {
        width: size,
        margin,
        errorCorrectionLevel: correction,
        color: { dark, light },
    };
    if (!options.icon) {
        if (format === 'base64') {
            return { contentType: 'application/json', body: await toDataURL(url, qrOpts) };
        }
        return { contentType: 'image/png', body: await toBuffer(url, qrOpts) };
    }
    const canvas = createCanvas(size, size);
    await qrToCanvas(canvas, url, qrOpts);
    const iconBuffer = await fetchIcon(options.icon);
    const iconImg = await loadImage(iconBuffer);
    const iconSize = clamp(options.iconSize, 'iconSize', Math.round(size * 0.2), 10, Math.round(size * 0.4));
    const iconPadding = clamp(options.iconPadding, 'iconPadding', 5, 0, 50);
    const maxRadius = Math.floor((iconSize + iconPadding * 2) / 2);
    const iconRadius = clamp(options.iconRadius, 'iconRadius', 0, 0, maxRadius);
    const ctx = canvas.getContext('2d');
    const totalSize = iconSize + iconPadding * 2;
    const x = (canvas.width - totalSize) / 2;
    const y = (canvas.height - totalSize) / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, totalSize, totalSize, iconRadius);
    ctx.fillStyle = light;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + iconPadding, y + iconPadding, iconSize, iconSize, Math.max(0, iconRadius - iconPadding));
    ctx.clip();
    ctx.drawImage(iconImg, x + iconPadding, y + iconPadding, iconSize, iconSize);
    ctx.restore();
    if (format === 'base64') {
        return { contentType: 'application/json', body: canvas.toDataURL('image/png') };
    }
    return { contentType: 'image/png', body: canvas.toBuffer('image/png') };
}
//# sourceMappingURL=qrcode.js.map