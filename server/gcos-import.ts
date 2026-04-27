import type { ConvexHttpClient } from "convex/browser";
import { deriveGcosProjectIntelligence } from "./gcos-project-intelligence";

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
  const projectIntelligence = deriveGcosProjectIntelligence(args.snapshot, args.normalizedGrant);
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
    nextReportDueAtISO: stringValue(args.normalizedGrant?.nextReportDueAtISO ?? projectIntelligence.nextReportDueAtISO),
    nextAction: stringValue(args.normalizedGrant?.nextAction ?? projectIntelligence.nextAction),
    sourceImportedAtISO: new Date().toISOString(),
    sourceFileCount: Number(args.snapshot?.agreement?.downloadedAgreementPdfs?.downloadedCount ?? 0),
    sourceExternalIds,
    confidence: "browser-snapshot",
    sensitivity: "contains-government-funding-records",
    riskFlags: ["Review imported GCOS data before relying on deadlines or amounts."],
    requirements: arrayValue(args.normalizedGrant?.requirements, projectIntelligence.requirements),
    timelineEvents: arrayValue(args.normalizedGrant?.timelineEvents, projectIntelligence.timelineEvents),
    complianceFlags: arrayValue(args.normalizedGrant?.complianceFlags, projectIntelligence.complianceFlags),
    useOfFunds: arrayValue(args.normalizedGrant?.useOfFunds, projectIntelligence.useOfFunds),
    nextSteps: arrayValue(args.normalizedGrant?.nextSteps, projectIntelligence.nextSteps),
    keyFacts: mergeStringLists(args.normalizedGrant?.keyFacts, projectIntelligence.keyFacts),
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
  const structured = snapshot.structured ?? {};
  const projectNumber = structured.projectInformation?.projectNumber ?? gcosTextValue(summary, "Project Number", ["Project Title"]) ?? gcosFieldValue(summary, [/project number/i, /tracking number/i]);
  const title = structured.projectInformation?.projectTitle ?? gcosTextValue(summary, "Project Title", ["Start Date"]) ?? gcosFieldValue(summary, [/project title/i]) ?? snapshot.project?.title ?? "GCOS project";
  const cfpTitle = structured.callForProposal?.title ?? gcosFieldValue(summary, [/cfp title/i, /call for proposal/i]) ?? "ESDC GCOS";
  const requested = gcosMoneyCents(
    structured.appliedFunding?.contributionEsdcRequested
    ?? gcosLandingContribution(snapshot.landing)
    ?? gcosFieldValue(summary, [/total contribution.*esdc/i, /amount requested/i, /requested/i]),
  );
  const awarded = gcosMoneyCents(structured.approvedJob?.contributionEsdcApproved ?? gcosFieldValue(approved, [/total contribution.*esdc/i, /approved/i, /contribution.*esdc/i]));
  const base = {
    title,
    funder: "Employment and Social Development Canada",
    program: cfpTitle,
    status: /closed/i.test(String(snapshot.project?.status ?? "")) ? "Closed" : /active|agreement|approved|final agreement/i.test(String(snapshot.project?.status ?? structured.agreement?.status ?? "")) ? "Active" : "Submitted",
    amountRequestedCents: requested,
    amountAwardedCents: awarded,
    startDate: gcosDate(structured.projectInformation?.startDate ?? gcosFieldValue(summary, [/start date/i])),
    endDate: gcosDate(structured.projectInformation?.endDate ?? gcosFieldValue(summary, [/end date/i])),
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
  return {
    ...base,
    ...deriveGcosProjectIntelligence(snapshot, base),
  };
}

function stringValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function arrayValue(value: unknown, fallback: unknown[]) {
  return Array.isArray(value) && value.length > 0 ? value : fallback.length > 0 ? fallback : undefined;
}

function mergeStringLists(...values: unknown[]) {
  const merged = new Set<string>();
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const text = String(item ?? "").trim();
      if (text) merged.add(text);
    }
  }
  return merged.size ? Array.from(merged) : undefined;
}

function gcosFieldValue(pageData: any, patterns: RegExp[]) {
  const fields = Array.isArray(pageData?.fields) ? pageData.fields : [];
  const found = fields.find((field: any) => patterns.some((pattern) => pattern.test(String(field.label ?? ""))));
  return found?.value;
}

function gcosTextValue(pageData: any, label: string, nextLabels: string[] = []) {
  const text = String(pageData?.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stops = nextLabels.length
    ? nextLabels.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
    : "[A-Z][A-Za-z /&()\\-]{2,80}";
  const match = text.match(new RegExp(`${escaped}:?\\s+(.+?)(?=\\s+(?:${stops})\\b|$)`, "i"));
  return match?.[1]?.trim();
}

function gcosMoneyCents(value: unknown) {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\$?\s*(\d+(?:\.\d{1,2})?)/);
  return match ? Math.round(Number(match[1]) * 100) : undefined;
}

function gcosLandingContribution(pageData: any) {
  const text = String(pageData?.text ?? "");
  return text.match(/Total Contribution \(ESDC\):\s*\$?([\d,.]+)/i)?.[1];
}

function gcosDate(value: unknown) {
  const text = String(value ?? "");
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().slice(0, 10);
}
