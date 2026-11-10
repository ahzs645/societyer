import { graphId, safeGraphContinuation, transcriptPath, transcriptSources, verifyTranscriptMetadata, type TeamsKind, type TeamsSource } from "./microsoftMeetings";
export class TeamsGraphError extends Error { constructor(public code: string, message: string) { super(message); } }
export async function boundedGraphBody(response: Response, maximum = 750_000): Promise<string> {
  if (!response.body || Number(response.headers.get("content-length")) > maximum) throw new TeamsGraphError("size", "Microsoft response exceeds the safe import size. Download and split the transcript manually.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > maximum) { await reader.cancel(); throw new TeamsGraphError("size", "Microsoft response exceeds the safe import size."); } chunks.push(part.value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export class TeamsGraphClient {
  constructor(private token: string, private tenantId: string, private request: typeof fetch = fetch) {}
  async get(path: string, text = false): Promise<any> {
    const url = path.startsWith("/") ? `https://graph.microsoft.com/v1.0${path}` : path;
    if (new URL(url).origin !== "https://graph.microsoft.com") throw new Error("Graph request left Microsoft.");
    const response = await this.request(url, { redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${this.token}`, Accept: text ? "text/vtt" : "application/json" } });
    const body = await boundedGraphBody(response);
    if (!response.ok) {
      let code = "GraphRequestFailed"; try { const error = JSON.parse(body).error; code = error?.innerError?.code ?? error?.code ?? code; } catch { /* Never expose raw Graph errors or URLs. */ }
      const messages: Record<string, string> = { GraphAccessToTranscriptsDisabled: "Teams Graph transcript access is disabled or the setting has not propagated yet.", SpeakerAttributionNotAllowed: "Teams speaker attribution is disabled or has not propagated yet.", Forbidden: "Microsoft denied this request. Check the connector consent and organizer application access policy.", Authorization_RequestDenied: "Microsoft denied this request. Check the connector's approved permissions.", TooManyRequests: "Microsoft is throttling requests. Wait and refresh this date range." };
      throw new TeamsGraphError(/^[a-zA-Z_]+$/.test(code) ? code : "GraphRequestFailed", messages[code] ?? `Microsoft could not complete this read (HTTP ${response.status}).`);
    }
    return text ? body : JSON.parse(body);
  }
  async discover(kind: TeamsKind, organizerId: string, start: string, end: string) {
    // The live v1.0 endpoint binds this function under /users/{id}. Its userId
    // parameter is Edm.String and needs quotes, despite the docs' root example.
    let next: string | null = kind === "adhoc" ? `/users/${organizerId}/adhocCalls/getAllTranscripts(userId='${organizerId}',startDateTime=${start},endDateTime=${end})` : `/users/${organizerId}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='${organizerId}',startDateTime=${start},endDateTime=${end})`;
    const values: TeamsSource[] = []; let pages = 0;
    while (next && pages++ < 5 && values.length < 100) {
      const data = await this.get(next); if (!Array.isArray(data.value)) throw new Error("Microsoft returned an invalid transcript list.");
      values.push(...transcriptSources(data.value, kind, organizerId, this.tenantId).filter(s => s.createdAt >= start && s.createdAt <= end));
      next = data["@odata.nextLink"] ? safeGraphContinuation(data["@odata.nextLink"], organizerId, kind) : null;
    }
    return { sources: values.slice(0, 100), truncated: Boolean(next) || values.length > 100 };
  }
  async transcript(source: TeamsSource) {
    const path = transcriptPath(source);
    const metadata = await this.get(path); verifyTranscriptMetadata(source, metadata, this.tenantId);
    return this.get(path + "/content", true) as Promise<string>;
  }
  async roster(chatId: string) {
    const data = await this.get(`/chats/${graphId(chatId)}/members`);
    if (!Array.isArray(data.value) || data.value.length > 250 || data["@odata.nextLink"]) throw new Error("This chat roster needs pagination support before it can be linked.");
    return data.value.filter((p: any) => typeof p.userId === "string" && typeof p.tenantId === "string").map((p: any) => ({ objectId: p.userId.toLowerCase(), tenantId: p.tenantId.toLowerCase(), name: String(p.displayName ?? "External participant").slice(0, 200) }));
  }
}
