/** Keep the shared shell independent of the assistant renderer and providers. */
export const OPEN_AI_ASSISTANT_EVENT = "societyer-ai:open";

/**
 * The assistant loads lazily, so a click that arrives before it is listening
 * would be lost. Remember a recent request; the assistant picks it up when it
 * mounts (or when the viewer's permission to use it resolves).
 */
const PENDING_OPEN_MS = 10_000;
let pendingOpenAt = 0;

/**
 * What to start the assistant with: a question, text attachments (a meeting's
 * notes and transcript, for example), and whether to send it right away.
 */
export type AiAssistantRequest = {
  prompt?: string;
  attachments?: Array<{ name: string; mediaType: string; text: string }>;
  send?: boolean;
};
let pendingRequest: AiAssistantRequest | null = null;

/** Opens the assistant. Takes no argument, so it can be an onClick handler as is. */
export function openGlobalAiAssistant() {
  pendingOpenAt = Date.now();
  pendingRequest = null;
  window.dispatchEvent(new Event(OPEN_AI_ASSISTANT_EVENT));
}

/** Opens the assistant with a question and context. */
export function askGlobalAiAssistant(request: AiAssistantRequest) {
  pendingOpenAt = Date.now();
  pendingRequest = request;
  window.dispatchEvent(new Event(OPEN_AI_ASSISTANT_EVENT));
}

/** The request that came with the last open, once. */
export function takePendingAiAssistantRequest(): AiAssistantRequest | null {
  const request = pendingRequest;
  pendingRequest = null;
  return request;
}

/** True once for a request made in the last few seconds that nobody handled yet. */
export function takePendingAiAssistantOpen(): boolean {
  const pending = pendingOpenAt > 0 && Date.now() - pendingOpenAt <= PENDING_OPEN_MS;
  pendingOpenAt = 0;
  return pending;
}
