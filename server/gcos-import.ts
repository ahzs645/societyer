import type { ConvexHttpClient } from "convex/browser";

type ConvexCall = { kind: "query" | "mutation" | "action"; name: string };
type ConvexCaller = (client: ConvexHttpClient, call: ConvexCall, args: Record<string, unknown>) => Promise<any>;

function query(name: string): ConvexCall {
  return { kind: "query", name };
}

function mutation(name: string): ConvexCall {
  return { kind: "mutation", name };
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export async function importGcosProjectSnapshotViaConvex(
  client: ConvexHttpClient,
  convexCall: ConvexCaller,
  args: { societyId: string; normalizedGrant: any; snapshot?: any; actingUserId?: string },
) {
  const sourceExternalIds = Array.isArray(args.normalizedGrant?.sourceExternalIds)
    ? args.normalizedGrant.sourceExternalIds.filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
    : [];
  const existingGrants: any[] = await convexCall(client, query("grants.list"), { societyId: args.societyId });
  const existing = sourceExternalIds.length
    ? existingGrants.find((grant) => (grant.sourceExternalIds ?? []).some((id: string) => sourceExternalIds.includes(id)))
    : undefined;
  const payload = dropUndefined({
    id: existing?._id,
    societyId: args.societyId,
    title: String(args.normalizedGrant?.title ?? "GCOS project"),
    funder: String(args.normalizedGrant?.funder ?? "Employment and Social Development Canada"),
    program: typeof args.normalizedGrant?.program === "string" ? args.normalizedGrant.program : undefined,
    status: String(args.normalizedGrant?.status ?? "Submitted"),
    opportunityType: "Government",
    opportunityUrl: typeof args.normalizedGrant?.opportunityUrl === "string" ? args.normalizedGrant.opportunityUrl : undefined,
    confirmationCode: typeof args.normalizedGrant?.confirmationCode === "string" ? args.normalizedGrant.confirmationCode : undefined,
    amountRequestedCents: typeof args.normalizedGrant?.amountRequestedCents === "number" ? args.normalizedGrant.amountRequestedCents : undefined,
    amountAwardedCents: typeof args.normalizedGrant?.amountAwardedCents === "number" ? args.normalizedGrant.amountAwardedCents : undefined,
    startDate: typeof args.normalizedGrant?.startDate === "string" ? args.normalizedGrant.startDate : undefined,
    endDate: typeof args.normalizedGrant?.endDate === "string" ? args.normalizedGrant.endDate : undefined,
    sourceImportedAtISO: new Date().toISOString(),
    sourceFileCount: Number(args.snapshot?.agreement?.downloadedAgreementPdfs?.downloadedCount ?? 0),
    sourceExternalIds,
    confidence: "browser-snapshot",
    sensitivity: "contains-government-funding-records",
    riskFlags: ["Review imported GCOS data before relying on deadlines or amounts."],
    keyFacts: Array.isArray(args.normalizedGrant?.keyFacts) ? args.normalizedGrant.keyFacts.filter((value: unknown) => typeof value === "string") : undefined,
    sourceNotes: typeof args.normalizedGrant?.sourceNotes === "string" ? args.normalizedGrant.sourceNotes : undefined,
    notes: "Imported from GCOS. Review against the original GCOS record before reporting or signing.",
    actingUserId: args.actingUserId,
  });
  const grantId = await convexCall(client, mutation("grants.upsertGrant"), payload);
  return { grantId, created: !existing, updated: Boolean(existing), fallback: "grants.upsertGrant" };
}

export function normalizeGcosExportedSnapshot(snapshot: any) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const summary = snapshot.summary ?? {};
  const approved = snapshot.approvedJobs ?? {};
  const projectNumber = gcosFieldValue(summary, [/project number/i, /tracking number/i]);
  const title = gcosFieldValue(summary, [/project title/i]) ?? snapshot.project?.title ?? "GCOS project";
  const cfpTitle = gcosFieldValue(summary, [/cfp title/i, /call for proposal/i]) ?? "ESDC GCOS";
  const requested = gcosMoneyCents(gcosFieldValue(summary, [/total contribution.*esdc/i, /amount requested/i, /requested/i]));
  const awarded = gcosMoneyCents(gcosFieldValue(approved, [/total contribution.*esdc/i, /approved/i, /contribution.*esdc/i]));
  return {
    title,
    funder: "Employment and Social Development Canada",
    program: cfpTitle,
    status: /closed/i.test(String(snapshot.project?.status ?? "")) ? "Closed" : /active|agreement|approved/i.test(String(snapshot.project?.status ?? "")) ? "Active" : "Submitted",
    amountRequestedCents: requested,
    amountAwardedCents: awarded,
    startDate: gcosDate(gcosFieldValue(summary, [/start date/i])),
    endDate: gcosDate(gcosFieldValue(summary, [/end date/i])),
    confirmationCode: projectNumber,
    sourceExternalIds: [
      snapshot.projectId ? `gcos:project:${snapshot.projectId}` : undefined,
      projectNumber ? `gcos:project-number:${projectNumber}` : undefined,
    ].filter(Boolean),
    opportunityUrl: typeof snapshot.currentUrl === "string" ? snapshot.currentUrl : undefined,
    keyFacts: [
      projectNumber ? `Project number: ${projectNumber}` : undefined,
      snapshot.projectId ? `GCOS project ID: ${snapshot.projectId}` : undefined,
      snapshot.programCode ? `Program code: ${snapshot.programCode}` : undefined,
      awarded != null && requested != null ? `Approved/requested delta: $${((awarded - requested) / 100).toFixed(2)}` : undefined,
    ].filter(Boolean),
    sourceNotes: "Imported from a read-only GCOS Chrome extension snapshot. Sensitive employee and banking fields are intentionally excluded.",
  };
}

function gcosFieldValue(pageData: any, patterns: RegExp[]) {
  const fields = Array.isArray(pageData?.fields) ? pageData.fields : [];
  const found = fields.find((field: any) => patterns.some((pattern) => pattern.test(String(field.label ?? ""))));
  return found?.value;
}

function gcosMoneyCents(value: unknown) {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\$?\s*(\d+(?:\.\d{1,2})?)/);
  return match ? Math.round(Number(match[1]) * 100) : undefined;
}

function gcosDate(value: unknown) {
  const text = String(value ?? "");
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().slice(0, 10);
}
