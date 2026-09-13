export interface DiceResult {
    roll: string;
    count: number;
    sides: number;
    modifier: number;
    results: number[];
    total: number;
}
/**
 * Rolls dice using standard tabletop notation and returns individual results with a total.
 *
 * @param roll - Dice notation string (e.g. "2d6+3", "d20", "4d8-1")
 * @returns Roll breakdown including count, sides, modifier, individual results, and total
 * @throws Error if the notation is missing, invalid, or out of bounds
 */
export default function dice(roll: string): DiceResult;
