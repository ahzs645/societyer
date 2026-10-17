/** Keep the shared shell independent of the assistant renderer and providers. */
export const OPEN_AI_ASSISTANT_EVENT = "societyer-ai:open";

/**
 * The assistant loads lazily, so a click that arrives before it is listening
 * would be lost. Remember a recent request; the assistant picks it up when it
 * mounts (or when the viewer's permission to use it resolves).
 */
const PENDING_OPEN_MS = 10_000;
let pendingOpenAt = 0;

export function openGlobalAiAssistant() {
  pendingOpenAt = Date.now();
  window.dispatchEvent(new Event(OPEN_AI_ASSISTANT_EVENT));
}

/** True once for a request made in the last few seconds that nobody handled yet. */
export function takePendingAiAssistantOpen(): boolean {
  const pending = pendingOpenAt > 0 && Date.now() - pendingOpenAt <= PENDING_OPEN_MS;
  pendingOpenAt = 0;
  return pending;
}
