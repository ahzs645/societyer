/** Keep the shared shell independent of the assistant renderer and providers. */
export const OPEN_AI_ASSISTANT_EVENT = "societyer-ai:open";

export function openGlobalAiAssistant() {
  window.dispatchEvent(new Event(OPEN_AI_ASSISTANT_EVENT));
}
