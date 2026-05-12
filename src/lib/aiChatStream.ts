export async function streamChatMessage({
  societyId,
  threadId,
  content,
  actingUserId,
  browsingContext,
  modelId,
  onToken,
}: {
  societyId: string;
  threadId?: string;
  content: string;
  actingUserId?: string;
  browsingContext?: unknown;
  modelId?: string;
  onToken: (token: string) => void;
}) {
  const response = await fetch(`${convexSiteUrl()}/ai-chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ societyId, threadId, content, actingUserId, browsingContext, modelId }),
  });
  if (!response.ok || !response.body) throw new Error(`Stream failed with ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: any = { threadId, provider: "sse" };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSseEvent(part);
      if (!event) continue;
      if (event.event === "token" && typeof event.data?.text === "string") onToken(event.data.text);
      if (event.event === "ready") result = { ...result, ...event.data, provider: "sse" };
      if (event.event === "done") result = { ...result, ...event.data, provider: "sse" };
      if (event.event === "error") throw new Error(event.data?.error ?? "Streaming failed");
    }
  }

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

function convexSiteUrl() {
  const apiUrl = String(import.meta.env.VITE_CONVEX_URL ?? "");
  if (apiUrl.includes(":3220")) return apiUrl.replace(":3220", ":3221");
  if (apiUrl.includes(":3210")) return apiUrl.replace(":3210", ":3211");
  return apiUrl.replace(/\/+$/, "");
}
