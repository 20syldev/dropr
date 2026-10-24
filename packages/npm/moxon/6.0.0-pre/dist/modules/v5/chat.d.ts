import type { ChatMessage, ChatStorage } from '../../types/storage.js';
interface ChatParams {
    username: string;
    message?: string;
    timestamp?: string;
    session?: string;
    token?: string;
    storage: ChatStorage;
}
/**
 * Handles real-time chat actions including sending, fetching, and clearing messages.
 *
 * @param action - The action to perform: "message", "private", "fetch", or "clear"
 * @param params - Chat parameters including username, message, session, and shared storage
 * @returns The result of the action — a message list, a sent confirmation, or a status message
 * @throws Error if a required parameter is missing or the action is invalid
 */
export default function chat(action: string, params: ChatParams): ChatMessage[] | ChatMessage | {
    message: string;
};
export {};
