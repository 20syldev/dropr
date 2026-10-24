export interface CreditCard {
    number: string;
    formatted: string;
    brand: string;
    expiry: string;
    cvv: string;
    luhn: true;
}
export interface CreditResult {
    cards: CreditCard[];
}
/**
 * Generates fictitious credit card numbers that pass Luhn validation.
 * These are for testing purposes only — not real card numbers.
 *
 * @param brand - Card brand: visa, mastercard, amex, discover (default: random)
 * @param count - Number of cards to generate (1–10, default 1)
 * @param format - Response format: full or masked (default: masked)
 * @returns Array of generated cards with number, formatted, expiry, cvv
 * @throws Error if brand is unknown, count is out of range, or format is invalid
 */
export default function credit(brand?: string, count?: number, format?: string): CreditResult;
