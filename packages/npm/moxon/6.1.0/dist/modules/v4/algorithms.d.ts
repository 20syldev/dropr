/**
 * Checks whether two strings are anagrams of each other.
 *
 * @param value - First string
 * @param value2 - Second string
 * @returns True if the strings are anagrams, false otherwise
 * @throws Error if either value is missing, not a string, or out of length bounds
 */
export declare function anagram(value: string, value2: string): boolean;
/**
 * Sorts a comma-separated list of numbers using the bubble sort algorithm.
 *
 * @param value - Comma-separated string of numbers (e.g. "3,1,2")
 * @returns Array of numbers sorted in ascending order
 * @throws Error if value is missing, non-numeric, or contains fewer than two elements
 */
export declare function bubblesort(value: string): number[];
/**
 * Computes the factorial of a non-negative integer.
 *
 * @param value - The integer to compute the factorial of
 * @returns The factorial of the given number
 * @throws Error if value is not a number, is negative, or exceeds the maximum allowed
 */
export declare function factorial(value: string | number): number;
/**
 * Returns the first n numbers of the Fibonacci sequence.
 *
 * @param value - How many Fibonacci numbers to generate
 * @returns Array of Fibonacci numbers starting from 0
 * @throws Error if value is not a number, is negative, or exceeds 1000
 */
export declare function fibonacci(value: string | number): number[];
/**
 * Computes the greatest common divisor of two positive integers using the Euclidean algorithm.
 *
 * @param value - First positive integer
 * @param value2 - Second positive integer
 * @returns The greatest common divisor
 * @throws Error if either value is not a positive number or exceeds the maximum allowed
 */
export declare function gcd(value: string | number, value2: string | number): number;
/**
 * Determines whether a given number is prime.
 *
 * @param value - The number to test
 * @returns True if the number is prime, false otherwise
 * @throws Error if value is not a positive number or exceeds the maximum allowed
 */
export declare function isprime(value: string | number): boolean;
/**
 * Checks whether a string reads the same forwards and backwards.
 *
 * @param value - The string to test
 * @returns True if the string is a palindrome, false otherwise
 * @throws Error if value is missing, not a string, or out of length bounds
 */
export declare function palindrome(value: string): boolean;
/**
 * Returns the prime factorization of a given integer.
 *
 * @param value - An integer greater than 1
 * @returns Array of prime factors in ascending order
 * @throws Error if value is not a number, less than 2, or exceeds the maximum allowed
 */
export declare function primefactors(value: string | number): number[];
/**
 * Returns all prime numbers up to and including the given limit.
 *
 * @param value - The upper bound (inclusive)
 * @returns Array of prime numbers up to the given limit
 * @throws Error if value is not a number, less than 2, or exceeds the maximum allowed
 */
export declare function primelist(value: string | number): number[];
/**
 * Reverses a string.
 *
 * @param value - The string to reverse
 * @returns The reversed string
 * @throws Error if value is missing or not a string
 */
export declare function reverse(value: string): string;
/**
 * Converts an integer to its Roman numeral representation, or a Roman numeral to an integer.
 *
 * @param value - An integer (1–3999) or a Roman numeral string
 * @returns The converted value — a Roman numeral string if input was numeric, or an integer if input was a Roman numeral
 * @throws Error if value is missing, out of range, or not a valid Roman numeral
 */
export declare function roman(value: string): number | string;
