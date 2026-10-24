export interface Address {
    street: string;
    city: string;
    zip: string;
    state: string;
    country: string;
    countryCode: string;
}
export interface AddressResult {
    addresses: Address[];
}
/**
 * Generates one or more fictional postal addresses for a given country.
 *
 * @param countryCode - Country code: "fr", "us", "uk", "de", or "es" (random if omitted)
 * @param count - Number of addresses to generate (1–10)
 * @returns Array of addresses with street, city, zip, state, country, and countryCode
 * @throws Error if the country code is invalid or count is out of range
 */
export default function address(countryCode?: string, count?: number): AddressResult;
