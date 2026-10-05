import { isLocalDataRuntime } from "./staticRuntime";
import { convexSiteUrl } from "./convexSite";
import { authenticatedFetch } from "./authToken";
import type { AiTextAttachment } from "../../shared/aiAttachments";

class ChatStreamUnavailable extends Error {}
export const isChatStreamUnavailable = (error: unknown) => error instanceof ChatStreamUnavailable;

export async function streamChatMessage({
  societyId,
  threadId,
  content,
  attachments,
  browsingContext,
  modelId,
  onToken,
  onThreadReady,
}: {
  societyId: string;
  threadId?: string;
  content: string;
  attachments?: AiTextAttachment[];
  browsingContext?: unknown;
  modelId?: string;
  onToken: (token: string) => void;
  onThreadReady?: (threadId: string) => void;
}) {
  if (isLocalDataRuntime()) throw new Error("Live AI streaming requires a connected workspace.");
  const response = await authenticatedFetch(`${convexSiteUrl()}/ai-chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ societyId, threadId, content, attachments, browsingContext, modelId }),
  });
  // Only an absent endpoint is safe to retry through an action. A broken stream
  // may already have persisted the request; replay would create duplicate chats.
  if (response.status === 404 || response.status === 405) throw new ChatStreamUnavailable("Live streaming endpoint is unavailable.");
  if (!response.ok || !response.body) throw new Error(`Stream failed with ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: any = { threadId, provider: "sse" };
  let completed = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSseEvent(part);
      if (!event) continue;
      if ((event.event === "ready" || event.event === "error") && typeof event.data?.threadId === "string") onThreadReady?.(event.data.threadId);
      if (event.event === "token" && typeof event.data?.text === "string") onToken(event.data.text);
      if (event.event === "ready") result = { ...result, ...event.data, provider: "sse" };
      if (event.event === "done") { result = { ...result, ...event.data, provider: "sse" }; completed = true; }
      if (event.event === "error") throw new Error(event.data?.error ?? "Streaming failed");
    }
  }
  if (!completed) throw new Error("The AI connection ended before the response completed. Check the saved conversation before retrying.");
  return result;
}

function parseSseEvent(chunk: string) {
  const lines = chunk.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");
  if (!data) return null;
  return { event, data: JSON.parse(data) };
}
