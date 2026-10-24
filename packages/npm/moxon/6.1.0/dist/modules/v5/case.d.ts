export interface CaseResult {
    text: string;
    to: string;
    result: string;
}
/**
 * Converts text to the specified case format.
 * Supports: camel, pascal, snake, kebab, constant, title, sentence, upper, lower.
 */
export default function caseConvert(text: string, to?: string): CaseResult;
