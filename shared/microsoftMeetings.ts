/** Read-only Graph connector policy. Credentials never enter browser code. */
export type TeamsKind = "scheduled" | "adhoc";
export type TeamsBinding = { societyId: string; organizerIds: string[]; chats: { id: string; name: string }[] };
export type TeamsSource = { kind: TeamsKind; resourceId: string; transcriptId: string; organizerId: string; createdAt: string; endAt?: string; title: string; chatId?: string; joinUrl?: string };
export const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function meetingBinding(env: Record<string, string | undefined>, societyId: string): TeamsBinding | null {
  const rows = JSON.parse(env.MICROSOFT_MEETINGS_BINDINGS ?? "[]") as TeamsBinding[];
  if (!Array.isArray(rows) || rows.length > 20) throw new Error("Invalid Teams workspace bindings.");
  const matches = rows.filter(row => row.societyId === societyId);
  if (matches.length > 1) throw new Error("Duplicate Teams workspace binding.");
  const row = matches[0];
  if (!row) return null;
  if (!Array.isArray(row.organizerIds) || !row.organizerIds.length || row.organizerIds.length > 20 || row.organizerIds.some(id => !uuidPattern.test(id)) || !Array.isArray(row.chats) || row.chats.length > 20 || row.chats.some(chat => typeof chat.id !== "string" || chat.id.length > 500 || !chat.name?.trim())) throw new Error("Invalid Teams workspace binding.");
  return row;
}
export function graphId(value: string): string {
  if (!value || value.length > 4000 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Invalid Microsoft resource identifier.");
  return encodeURIComponent(value);
}
export function transcriptPath(source: TeamsSource): string {
  if (!uuidPattern.test(source.organizerId) || !["scheduled", "adhoc"].includes(source.kind)) throw new Error("Invalid Teams source.");
  return `/users/${source.organizerId}/${source.kind === "adhoc" ? "adhocCalls" : "onlineMeetings"}/${graphId(source.resourceId)}/transcripts/${graphId(source.transcriptId)}`;
}
export function validateDateWindow(start: string, end: string) {
  const a = Date.parse(start), b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 31 * 86400_000) throw new Error("Choose a date range of at most 31 days.");
  return { start: new Date(a).toISOString(), end: new Date(b).toISOString() };
}
export function sourceKey(source: TeamsSource) { return `${source.kind}:${source.organizerId}:${source.resourceId}`; }
export function verifyTranscriptMetadata(source: TeamsSource, value: any, tenantId: string) {
  const organizer = value?.meetingOrganizer?.user;
  if (value?.id !== source.transcriptId || (source.kind === "adhoc" ? value.callId : value.meetingId) !== source.resourceId || organizer?.id?.toLowerCase() !== source.organizerId.toLowerCase() || organizer?.tenantId?.toLowerCase() !== tenantId.toLowerCase()) throw new Error("Microsoft transcript identity did not match the approved source.");
}
export function transcriptSources(values: any[], kind: TeamsKind, organizerId: string, tenantId: string): TeamsSource[] {
  return values.map(value => {
    const createdAt = new Date(value.createdDateTime).toISOString();
    const source: TeamsSource = { kind, organizerId, resourceId: kind === "adhoc" ? value.callId : value.meetingId, transcriptId: value.id, createdAt, ...(value.endDateTime ? { endAt: new Date(value.endDateTime).toISOString() } : {}), title: `Teams ${kind === "adhoc" ? "call" : "meeting"} — ${createdAt.slice(0, 10)}` };
    graphId(source.resourceId); graphId(source.transcriptId);
    verifyTranscriptMetadata(source, value, tenantId);
    return source;
  });
}
export function safeGraphContinuation(value: string, organizerId: string, kind: TeamsKind): string {
  const url = new URL(value);
  const path = decodeURIComponent(url.pathname);
  const suffix = `${kind === "adhoc" ? "adhocCalls" : "onlineMeetings"}/getAllTranscripts`;
  const scopedPath = [`/v1.0/users/${organizerId}/${suffix}`, `/v1.0/users('${organizerId}')/${suffix}`].some(base => path === base || path.startsWith(base + "("));
  if (url.origin !== "https://graph.microsoft.com" || url.username || url.password || url.hash || !scopedPath || [...url.searchParams.keys()].some(key => /token|secret|authorization/i.test(key) && !/skiptoken|deltatoken/i.test(key))) throw new Error("Microsoft pagination left the approved organizer scope.");
  return url.href;
}
