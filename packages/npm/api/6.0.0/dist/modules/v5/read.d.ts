export interface ReadResult {
    lang: string;
    words: number;
    sentences: number;
    syllables: number;
    fleschReadingEase: number;
    fleschKincaidGrade: number | null;
    readingTime: string;
}
/**
 * Computes Flesch readability scores on a text. English uses the original
 * Flesch coefficients; French uses the Kandel & Moles adaptation, which has no
 * grade-level counterpart, so fleschKincaidGrade is null for French.
 *
 * @param text - The text to analyze
 * @param lang - Language of the text: en (default) or fr
 * @returns Word, sentence and syllable counts, Flesch scores and estimated reading time
 * @throws Error if the text is missing or too long, or if the language is unsupported
 */
export default function read(text: string, lang?: string): ReadResult;
