export interface CaptchaOptions {
    text?: string;
    length?: number;
    width?: number;
    height?: number;
    noise?: 'low' | 'medium' | 'high';
    bg?: string;
    color?: string;
}
export interface CaptchaResult {
    contentType: string;
    body: Buffer;
    text: string;
}
/**
 * Generates a CAPTCHA image with random or custom text and configurable noise.
 *
 * @param options - Captcha configuration options
 * @returns Object containing the PNG buffer, content type, and the challenge text
 * @throws Error if any option is out of the accepted range
 */
export default function captcha(options: CaptchaOptions): CaptchaResult;
