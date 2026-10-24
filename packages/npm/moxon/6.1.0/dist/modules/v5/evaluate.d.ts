export interface EvaluateResult {
    expression: string;
    result: number;
    precision: number;
}
/**
 * Evaluates a mathematical expression string and returns the result.
 *
 * @param expr - Math expression; supports +, -, *, /, %, ^, unary -, parentheses, constants (pi, e) and functions (sin, cos, tan, sqrt, abs, ceil, floor, round, log, log2, log10, exp, min, max)
 * @param precision - Number of decimal places in the result (0–15, default 10)
 * @returns Object with the original expression, numeric result, and applied precision
 * @throws Error if the expression is empty, exceeds the maximum length, contains unknown identifiers, or produces a non-finite result
 */
export default function evaluate(expr: string, precision?: number): EvaluateResult;
