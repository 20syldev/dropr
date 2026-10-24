/**
 * Converts a numeric value from one unit to another.
 *
 * @param value - The numeric value to convert
 * @param from - The source unit (e.g. "km", "celsius", "kg")
 * @param to - The target unit (e.g. "mi", "fahrenheit", "lb")
 * @returns Object with source unit, target unit, original value, and converted result
 * @throws Error if the conversion pair is unsupported, the value is NaN, or the temperature is below absolute zero
 */
export default function convert(value: number, from: string, to: string): {
    from: string;
    to: string;
    value: number;
    result: number;
};
