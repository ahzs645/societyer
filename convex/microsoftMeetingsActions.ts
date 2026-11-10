import { v } from "convex/values";
import { importPKCS8, SignJWT } from "jose";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { authorizedAction } from "./lib/authorizedServer";
import { TeamsGraphClient, boundedGraphBody, TeamsGraphError } from "../shared/teamsGraphClient";
import { validateDateWindow, uuidPattern, type TeamsSource } from "../shared/microsoftMeetings";
import { parseTimedTranscript } from "../src/features/meetings/transcript/timedTranscript";
import { createAuth } from "./hostedAuth";

async function graph() {
  const tenant = process.env.MICROSOFT_MEETINGS_TENANT_ID ?? "", client = process.env.MICROSOFT_MEETINGS_CLIENT_ID ?? "";
  const pem = process.env.MICROSOFT_MEETINGS_PRIVATE_KEY, thumbprint = process.env.MICROSOFT_MEETINGS_CERT_SHA256;
  if (!uuidPattern.test(tenant) || !uuidPattern.test(client) || !pem || !thumbprint) throw new Error("The Teams connector certificate has not been configured.");
  const endpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const assertion = await new SignJWT({}).setProtectedHeader({ alg: "PS256", "x5t#S256": thumbprint }).setIssuer(client).setSubject(client).setAudience(endpoint).setIssuedAt().setExpirationTime("5m").setJti(crypto.randomUUID()).sign(await importPKCS8(pem, "PS256"));
  const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: client, scope: "https://graph.microsoft.com/.default", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion }) });
  const data = JSON.parse(await boundedGraphBody(response, 32_000));
  if (!response.ok || typeof data.access_token !== "string") throw new Error("The Teams connector could not authenticate. Check its certificate and administrator consent.");
  return new TeamsGraphClient(data.access_token, tenant);
}
export const discover = authorizedAction("microsoftMeetingsActions:discover", action)({ args: { societyId: v.id("societies"), start: v.string(), end: v.string() }, returns: v.any(), handler: async (ctx, a) => {
  const access = await ctx.runQuery(internal.microsoftMeetings.access, { societyId: a.societyId });
  const window = validateDateWindow(a.start, a.end); const client = await graph(); const sources: TeamsSource[] = []; const warnings: string[] = [];
  for (const organizer of access.binding.organizerIds) for (const kind of ["adhoc", "scheduled"] as const) {
    try { const result = await client.discover(kind, organizer, window.start, window.end); sources.push(...result.sources); if (result.truncated) warnings.push(`${kind} results were limited. Choose a shorter date range for the remainder.`); }
    catch (error) { warnings.push(`${kind === "adhoc" ? "Group calls" : "Scheduled meetings"}: ${error instanceof TeamsGraphError ? error.message : "Microsoft discovery could not finish. Check the connection and retry."}`); }
  }
  const unique = [...new Map(sources.map(s => [`${s.kind}:${s.organizerId}:${s.resourceId}`, s])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  const candidates = await ctx.runMutation(internal.microsoftMeetings.stage, { societyId: a.societyId, sources: unique });
  return { candidates, warnings: [...new Set(warnings)], checkedAt: Date.now() };
} });
export const importMeeting = authorizedAction("microsoftMeetingsActions:importMeeting", action, a => ({ societyId: a.societyId, candidateId: a.candidateId }))({ args: { societyId: v.id("societies"), candidateId: v.id("microsoftMeetingCandidates"), title: v.string(), contextChatId: v.optional(v.string()), contextChatConfirmed: v.boolean() }, returns: v.id("meetings"), handler: async (ctx, a) => {
  const access = await ctx.runQuery(internal.microsoftMeetings.access, { societyId: a.societyId, candidateId: a.candidateId });
  if (a.contextChatId && (!a.contextChatConfirmed || !access.binding.chats.some((c: any) => c.id === a.contextChatId))) throw new Error("Select and confirm an approved chat.");
  const client = await graph(); const text = await client.transcript(access.candidate.source);
  const parsed = parseTimedTranscript("teams.vtt", text);
  const participants = a.contextChatId ? await client.roster(a.contextChatId) : [];
  const { internalAdapter } = await createAuth(ctx).$context;
  const resolved: any[] = [];
  for (const p of participants) {
    const account = p.tenantId === process.env.MICROSOFT_MEETINGS_TENANT_ID?.toLowerCase() ? await internalAdapter.findAccountByKey({ providerId: "microsoft", accountId: p.objectId }) : null;
    const user = account ? access.users.find((u: any) => u.authSubject === account.userId) : null;
    resolved.push({ ...p, ...(user ? { userId: user.id } : {}) });
  }
  const transcriptHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join("");
  // Reauthorize in the same transaction as every write, after all external reads.
  return ctx.runMutation(internal.microsoftMeetings.commitImport, { ...a, transcriptId: access.candidate.source.transcriptId, transcriptHash, segments: parsed.segments, participants: resolved });
} });
