/**
 * PORTABLE FUNCTIONS: the firm-wide (cross-entity) layer.
 *
 * `overviewPortable` rolls up each entity's open deadlines + post-incorporation
 * progress over `ctx.db`, running unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 *
 * `searchPortable` runs the firm-wide quick search over the portable
 * `withSearchIndex` contract (a tokenized prefix scan on the local adapters, the
 * real full-text index on Convex). `batchGeneratePacket` (raw-ctx packet
 * generation) stays in convex/firm.ts.
 */

import { documentAccessPredicate } from "./documents";
import { listAuthorizedSocietyRows } from "./society";
import { requirePermissionPortable, type Permission } from "./permissions";
import { visibleDirectoryRows } from "./peopleDirectory";
import type { PortableQueryCtx } from "../portable/ctx";
import { organizationKind, organizationLabel } from "../organizationDomain";
import { postIncorporationStepsForOrganization } from "../postIncorporationSteps";
import { todayDateOnly } from "../dateOnly";

async function permits(ctx: PortableQueryCtx, societyId: string, permission: Permission) {
  try { await requirePermissionPortable(ctx, societyId, permission); return true; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === `Permission ${permission} required.` || message === `Service scope ${permission} required.`) return false;
    throw error;
  }
}

function deadlineOpen(d: any): boolean {
  const status = d.status ?? (d.done ? "complete" : "open");
  return status === "open";
}

/** Resolve generated packet keys from a society's precedent runs. */
function generatedPacketKeysFromRuns(runs: any[]): Set<string> {
  const keys = new Set<string>();
  for (const run of runs) {
    for (const id of run.sourceExternalIds ?? []) {
      const match = /-packet-run:(.+)$/.exec(String(id));
      if (match) keys.add(match[1]);
    }
  }
  return keys;
}

export async function overviewPortable(ctx: PortableQueryCtx, { todayISO }: { todayISO?: string }) {
  const today = todayISO ? todayISO.slice(0, 10) : todayDateOnly();
  const societies = await listAuthorizedSocietyRows(ctx);

  const entities: any[] = [];
  for (const society of societies) {
    // Portfolio counts expose compliance and legal-operation records.
    if (!await permits(ctx, society._id, "deadlines:read") || !await permits(ctx, society._id, "documents:read")) continue;
    const [deadlines, runs] = await Promise.all([
      ctx.db.query("deadlines").withIndex("by_society", (q) => q.eq("societyId", society._id)).collect(),
      ctx.db.query("legalPrecedentRuns").withIndex("by_society", (q) => q.eq("societyId", society._id)).collect(),
    ]);
    const open = deadlines.filter(deadlineOpen);
    const overdue = open.filter((d: any) => String(d.dueDate ?? "") < today).length;

    const steps = postIncorporationStepsForOrganization(society as any);
    const packetSteps = steps.filter((s) => s.packetKey);
    const generated = generatedPacketKeysFromRuns(runs);
    const stepsDone = packetSteps.filter((s) => generated.has(s.packetKey as string)).length;

    entities.push({
      _id: society._id,
      name: organizationLabel(society as any),
      kind: organizationKind(society as any),
      incorporationNumber: society.incorporationNumber ?? null,
      status: society.organizationStatus ?? null,
      overdueDeadlines: overdue,
      upcomingDeadlines: open.length - overdue,
      openDeadlines: open.length,
      postIncorpTotal: packetSteps.length,
      postIncorpDone: stepsDone,
    });
  }
  entities.sort((a, b) => b.overdueDeadlines - a.overdueDeadlines || a.name.localeCompare(b.name));

  return {
    today,
    entities,
    totals: {
      entities: entities.length,
      corporations: entities.filter((e) => e.kind === "corporation").length,
      societies: entities.filter((e) => e.kind === "society").length,
      overdueDeadlines: entities.reduce((sum, e) => sum + e.overdueDeadlines, 0),
      upcomingDeadlines: entities.reduce((sum, e) => sum + e.upcomingDeadlines, 0),
    },
  };
}

export type GlobalSearchKind =
  | "deadline" | "document" | "person" | "member" | "meeting" | "minutes" | "motion" | "task"
  | "committee" | "grant" | "policy" | "insurance" | "filing" | "agreement";

export type GlobalSearchResult = {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  /** Short context shown under the title (date, type, status). */
  subtitle?: string;
  societyId: string | null;
  societyName: string | null;
  /** In-app route that opens the record itself (detail page or `?record=` side panel). */
  to: string;
};

/** Per-kind cap so one busy table cannot crowd every other kind out. */
const SEARCH_LIMIT_PER_KIND = 8;

/** Lower-cased, accent-folded text for substring matching. */
export function searchFold(value: unknown): string {
  return String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Every whitespace-separated term of the query must appear somewhere in the fields. */
export function searchMatches(query: string, fields: unknown[]): boolean {
  const terms = searchFold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return false;
  const haystack = fields.map((field) => (Array.isArray(field) ? field.map(searchFold).join(" ") : searchFold(field))).join(" \u0000 ");
  return terms.every((term) => haystack.includes(term));
}

function minutesSearchFields(row: any): unknown[] {
  const sections = Array.isArray(row.sections) ? row.sections : [];
  return [
    row.discussion,
    row.chairName,
    row.secretaryName,
    sections.map((section: any) => [section?.title, section?.discussion, section?.motionText, ...(Array.isArray(section?.decisions) ? section.decisions : [])].filter(Boolean).join(" ")),
    Array.isArray(row.motions) ? row.motions.map((motion: any) => motion?.text ?? "") : [],
  ];
}

/** Scans one society-scoped table and keeps the first matches (records are already permission-checked). */
async function scanSociety(ctx: PortableQueryCtx, table: string, societyId: string, query: string, fields: (row: any) => unknown[]) {
  const rows = await ctx.db.query(table as any).withIndex("by_society" as any, (q: any) => q.eq("societyId", societyId)).collect();
  const hits: any[] = [];
  for (const row of rows) {
    if (searchMatches(query, fields(row))) hits.push(row);
    if (hits.length >= SEARCH_LIMIT_PER_KIND) break;
  }
  return hits;
}

/** "AnnualReport" -> "Annual report"; codes such as "T3010" stay as they are. */
export function humanizeRecordKind(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(text)) return text;
  const words = text.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
  return [words[0], ...words.slice(1).map((word) => word.toLowerCase())].join(" ");
}

function shortDate(value: unknown) {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : undefined;
}

export async function searchPortable(ctx: PortableQueryCtx, { query: term }: { query: string }): Promise<GlobalSearchResult[]> {
  const q = String(term ?? "").trim();
  if (q.length < 2) return [];
  const societies = await listAuthorizedSocietyRows(ctx);
  const results: GlobalSearchResult[] = [];
  const directory = new Map<string, any>();
  /** Organization whose directory listed the person (legacy rows carry no societyId). */
  const personSociety = new Map<string, string>();
  for (const society of societies) {
    const societyId = String(society._id);
    const societyName = organizationLabel(society as any);
    const push = (row: Omit<GlobalSearchResult, "societyId" | "societyName">) => results.push({ ...row, societyId, societyName });
    if (await permits(ctx, societyId, "deadlines:read")) {
      const deadlines = await ctx.db.query("deadlines").withSearchIndex("search_title", s => s.search("title", q).eq("societyId", societyId)).take(12);
      for (const row of deadlines) push({ kind: "deadline", id: String(row._id), title: row.title, subtitle: shortDate(row.dueDate), to: `/app/deadlines?record=${encodeURIComponent(String(row._id))}` });
    }
    if (await permits(ctx, societyId, "documents:read")) {
      const allows = await documentAccessPredicate(ctx, societyId);
      const documents = await ctx.db.query("documents").withSearchIndex("search_title", s => s.search("title", q).eq("societyId", societyId)).filter(allows).take(12);
      for (const row of documents) push({ kind: "document", id: String(row._id), title: row.title, subtitle: row.category, to: `/app/documents/${encodeURIComponent(String(row._id))}` });
      for (const row of await scanSociety(ctx, "policies", societyId, q, (r) => [r.policyName, r.policyNumber, r.owner])) {
        push({ kind: "policy", id: String(row._id), title: row.policyName, subtitle: row.reviewDate ? `Review ${row.reviewDate}` : row.policyNumber, to: `/app/policies?record=${encodeURIComponent(String(row._id))}` });
      }
    }
    if (await permits(ctx, societyId, "members:read")) {
      for (const row of await visibleDirectoryRows(ctx, societyId)) {
        directory.set(String(row._id), row);
        if (!personSociety.has(String(row._id))) personSociety.set(String(row._id), societyId);
      }
      for (const row of await scanSociety(ctx, "members", societyId, q, (r) => [`${r.firstName ?? ""} ${r.lastName ?? ""}`, r.email, r.membershipClass])) {
        push({ kind: "member", id: String(row._id), title: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || String(row.email ?? "Member"), subtitle: row.status, to: `/app/members/${encodeURIComponent(String(row._id))}` });
      }
    }
    const meetingTitles = new Map<string, any>();
    if (await permits(ctx, societyId, "meetings:read")) {
      const meetings = await ctx.db.query("meetings").withIndex("by_society", (s: any) => s.eq("societyId", societyId)).collect();
      for (const meeting of meetings) meetingTitles.set(String(meeting._id), meeting);
      let count = 0;
      for (const row of meetings) {
        if (count >= SEARCH_LIMIT_PER_KIND) break;
        if (!searchMatches(q, [row.title, row.type, row.location])) continue;
        count += 1;
        push({ kind: "meeting", id: String(row._id), title: row.title, subtitle: [row.type, shortDate(row.scheduledAt)].filter(Boolean).join(" · "), to: `/app/meetings/${encodeURIComponent(String(row._id))}` });
      }
    }
    if (await permits(ctx, societyId, "minutes:read")) {
      for (const row of await scanSociety(ctx, "minutes", societyId, q, minutesSearchFields)) {
        const meeting = meetingTitles.get(String(row.meetingId));
        push({ kind: "minutes", id: String(row._id), title: `Minutes: ${meeting?.title ?? "meeting"}`, subtitle: shortDate(row.heldAt ?? meeting?.scheduledAt), to: `/app/meetings/${encodeURIComponent(String(row.meetingId))}?tab=minutes` });
      }
    }
    if (await permits(ctx, societyId, "motions:read")) {
      for (const row of await scanSociety(ctx, "motions", societyId, q, (r) => [r.title, r.text, r.movedBy, r.secondedBy])) {
        const text = String(row.title || row.text || "Motion");
        push({ kind: "motion", id: String(row._id), title: text.length > 90 ? `${text.slice(0, 87)}…` : text, subtitle: row.outcome ?? row.status, to: `/app/motions?record=${encodeURIComponent(String(row._id))}` });
      }
    }
    if (await permits(ctx, societyId, "tasks:read")) {
      for (const row of await scanSociety(ctx, "tasks", societyId, q, (r) => [r.title, r.description, r.assignee])) {
        push({ kind: "task", id: String(row._id), title: row.title, subtitle: [row.status, row.dueDate ? `due ${shortDate(row.dueDate)}` : ""].filter(Boolean).join(" · "), to: `/app/tasks?record=${encodeURIComponent(String(row._id))}` });
      }
    }
    if (await permits(ctx, societyId, "committees:read")) {
      for (const row of await scanSociety(ctx, "committees", societyId, q, (r) => [r.name, r.description, r.mission])) {
        push({ kind: "committee", id: String(row._id), title: row.name, subtitle: row.cadence, to: `/app/committees/${encodeURIComponent(String(row._id))}` });
      }
    }
    if (await permits(ctx, societyId, "grants:read")) {
      for (const row of await scanSociety(ctx, "grants", societyId, q, (r) => [r.title, r.funder, r.program, r.opportunityType])) {
        push({ kind: "grant", id: String(row._id), title: row.title, subtitle: [row.funder, row.status].filter(Boolean).join(" · "), to: `/app/grants/${encodeURIComponent(String(row._id))}` });
      }
    }
    if (await permits(ctx, societyId, "agreements:read")) {
      for (const row of await scanSociety(ctx, "agreements", societyId, q, (r) => [r.title, r.agreementNumber, r.kind, ...(Array.isArray(r.parties) ? r.parties.map((party: any) => party?.name) : [])])) {
        const counterparty = (Array.isArray(row.parties) ? row.parties : []).find((party: any) => party?.role !== "us")?.name;
        push({ kind: "agreement", id: String(row._id), title: row.title, subtitle: [counterparty, row.status, row.endDate ? `ends ${row.endDate}` : ""].filter(Boolean).join(" · "), to: `/app/agreements/${encodeURIComponent(String(row._id))}` });
      }
    }
    if (await permits(ctx, societyId, "financials:read")) {
      for (const row of await scanSociety(ctx, "insurancePolicies", societyId, q, (r) => [r.insurer, r.broker, r.policyNumber, r.kind, r.policyTermLabel])) {
        push({ kind: "insurance", id: String(row._id), title: `${row.insurer} · ${row.policyNumber}`, subtitle: [row.kind, row.renewalDate ? `renews ${row.renewalDate}` : ""].filter(Boolean).join(" · "), to: `/app/insurance/${encodeURIComponent(String(row._id))}` });
      }
    }
    if (await permits(ctx, societyId, "filings:read")) {
      for (const row of await scanSociety(ctx, "filings", societyId, q, (r) => [r.kind, r.periodLabel, r.notes, r.confirmationNumber])) {
        push({ kind: "filing", id: String(row._id), title: [humanizeRecordKind(row.kind), row.periodLabel].filter(Boolean).join(" · "), subtitle: [row.status, row.dueDate ? `due ${row.dueDate}` : ""].filter(Boolean).join(" · "), to: `/app/filings?record=${encodeURIComponent(String(row._id))}` });
      }
    }
  }
  // Preserve the full-text match behavior while filtering the complete result
  // set before limiting; foreign hits must neither leak nor hide owned hits.
  const people = await ctx.db.query("peopleDirectory").withSearchIndex("search_full_name", s => s.search("fullName", q)).filter(row => directory.has(String(row._id))).take(12);
  // A person belongs to one organization; carry it so opening the hit switches
  // to that organization (it opened "Person not found" from another one).
  const societyNames = new Map(societies.map((society) => [String(society._id), organizationLabel(society as any)]));
  for (const person of people) {
    const societyId = person.societyId ? String(person.societyId) : personSociety.get(String(person._id)) ?? null;
    results.push({ kind: "person", id: String(person._id), title: person.fullName, societyId, societyName: societyId ? societyNames.get(societyId) ?? null : null, to: `/app/people-directory/${encodeURIComponent(String(person._id))}` });
  }
  return results;
}
