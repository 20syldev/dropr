import type { TicTacToeStorage } from '../../types/storage.js';
interface TicTacToeParams {
    username?: string;
    move?: string;
    session?: string;
    game?: string;
    private?: boolean;
    storage: TicTacToeStorage;
}
/**
 * Handles Tic-Tac-Toe game actions including playing a move, fetching game state, listing games, and forfeiting.
 *
 * @param action - The action to perform: "play", "fetch", "list", or "forfeit"
 * @param params - Game parameters including username, move, session, game ID, and shared storage
 * @returns Game state or action result depending on the action
 * @throws Error if a required parameter is missing, the action is invalid, or a rate limit is exceeded
 */
export default function tic_tac_toe(action: string, params: TicTacToeParams): Record<string, unknown>;
export {};
