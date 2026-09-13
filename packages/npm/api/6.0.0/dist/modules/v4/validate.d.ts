/**
 * Validates a credit/debit card number using the Luhn algorithm.
 *
 * @param value - Card number string (digits, spaces, or dashes allowed)
 * @returns Object containing the validity result and the sanitized digit string
 * @throws Error if value is missing, contains non-digit characters, or has an invalid length
 */
export declare function luhn(value: string): {
    valid: boolean;
    value: string;
};
/**
 * Validates an IBAN using the mod-97 checksum algorithm.
 *
 * @param value - IBAN string (spaces allowed)
 * @returns Object containing the validity result, sanitized IBAN, and country code
 * @throws Error if value is missing, has an invalid format, or is out of length bounds
 */
export declare function iban(value: string): {
    valid: boolean;
    value: string;
    country?: string;
};
/**
 * Validates an email address against a basic format check.
 *
 * @param value - The email address string to validate
 * @returns Object containing the validity result and the original value
 * @throws Error if value is missing, not a string, or too long
 */
export declare function email(value: string): {
    valid: boolean;
    value: string;
};
