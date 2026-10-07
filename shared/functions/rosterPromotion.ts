/**
 * PORTABLE FUNCTIONS: build registers from source roster observations (WP-H).
 *
 * - P15 committees:buildRostersFromSeats — roster sheets (organizationSeats
 *   grouped by sheet) become pending committee members, linked to the person
 *   the identity review chose, with the seat and observation kept as source.
 * - P16 directors:rosterSuggestions / directors:promoteRosterObservation —
 *   board roster observations can be promoted to a director register entry
 *   with status "NeedsReview" (never counted as an active director until a
 *   person confirms term, consent and residency).
 */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow } from "./access";
import { requirePermissionPortable } from "./permissions";
import { liveObservations, observationTerm, seatRosterSheet } from "./memberGovernance";
import { normalizeSearchName } from "../peopleDirectory";
import { splitDirectoryName } from "./peopleDirectory";

const now = () => new Date().toISOString();
const BOARD_SHEET = /\bboard\b/i;
const NON_COMMITTEE_SHEET = /^(?:\d{4}\s+)?(?:board|staff|.*\bstaff|other|contacts?)$/i;
const PERSON_KINDS = new Set(["representative", "contact", "organization_member", "staff"]);

const sheetKey = (value: string) => normalizeSearchName(value).replace(/\b(committee|working group|wg)\b/g, (m) => (m === "working group" ? "wg" : m)).trim();

async function seatPeople(ctx: PortableQueryCtx, societyId: string) {
  const [seats, occurrences] = await Promise.all([
    ctx.db.query("organizationSeats").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("personOccurrences").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const linked = new Map<string, string>();
  for (const o of occurrences) {
    if (o.recordTable !== "organizationSeats" || !o.personId || ["rejected", "not_person", "unresolved"].includes(o.matchStatus)) continue;
    linked.set(`${o.recordId}::${normalizeSearchName(o.personName)}`, o.personId);
  }
  const rows: Array<{ seat: any; observation: any; sheet: string | undefined; personId?: string }> = [];
  for (const seat of seats) {
    if (seat.status === "retired") continue;
    const sheet = seatRosterSheet(seat);
    for (const observation of liveObservations(seat)) {
      if (!observation.personName || !PERSON_KINDS.has(observation.kind) || observation.reviewStatus === "rejected") continue;
      rows.push({ seat, observation, sheet, personId: observation.personId ?? linked.get(`${seat._id}::${normalizeSearchName(observation.personName)}`) });
    }
  }
  return rows;
}

/* --------------------------------- P15 ---------------------------------- */

export async function buildRostersFromSeats(ctx: PortableMutationCtx, args: { societyId: string; dryRun?: boolean; createMissingCommittees?: boolean }) {
  await requirePermissionPortable(ctx, args.societyId, "committees:write");
  await requirePermissionPortable(ctx, args.societyId, "members:read");
  const dryRun = args.dryRun !== false;
  const committees = await ctx.db.query("committees").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  const existing = await ctx.db.query("committeeMembers").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  const seen = new Set(existing.filter((row) => row.sourceSeatId).map((row) => `${row.sourceSeatId}::${row.sourceObservationId}`));
  const findCommittee = (sheet: string) => {
    const key = sheetKey(sheet);
    return committees.find((c) => sheetKey(c.name) === key || (c.bodyKey && sheetKey(c.bodyKey) === key) || sheetKey(c.name).split(" ")[0] === key && key.length >= 3);
  };
  const plan = new Map<string, { sheet: string; committeeId?: string; committeeName: string; create: boolean; rows: any[] }>();
  const skippedSheets = new Map<string, number>();
  for (const row of await seatPeople(ctx, args.societyId)) {
    const committee = row.seat.committeeId ? committees.find((c) => c._id === row.seat.committeeId) : row.sheet ? findCommittee(row.sheet) : undefined;
    if (!committee && (!row.sheet || NON_COMMITTEE_SHEET.test(row.sheet))) { skippedSheets.set(row.sheet ?? "(no sheet)", (skippedSheets.get(row.sheet ?? "(no sheet)") ?? 0) + 1); continue; }
    const key = committee?._id ?? `new:${sheetKey(row.sheet!)}`;
    const entry = plan.get(key) ?? { sheet: row.sheet ?? committee!.name, committeeId: committee?._id, committeeName: committee?.name ?? row.sheet!, create: !committee, rows: [] as any[] };
    if (!seen.has(`${row.seat._id}::${row.observation.id}`)) entry.rows.push(row);
    plan.set(key, entry);
  }
  // One roster row per person per committee: a roster sheet read twice (2022 and
  // 2025) lists the same people again. Keep the latest observation as the source
  // and the earliest date as "joined"; skip people already on the roster.
  const personKey = (row: any) => row.personId ? `p:${row.personId}` : `n:${normalizeSearchName(row.observation.personName)}`;
  for (const entry of plan.values()) {
    const onRoster = new Set(existing.filter((m) => m.committeeId === entry.committeeId).flatMap((m) => [m.personId ? `p:${m.personId}` : "", `n:${normalizeSearchName(m.name)}`]));
    const byPerson = new Map<string, any[]>();
    for (const row of entry.rows) { const key = personKey(row); if (onRoster.has(key) || onRoster.has(`n:${normalizeSearchName(row.observation.personName)}`)) continue; byPerson.set(key, [...(byPerson.get(key) ?? []), row]); }
    entry.rows = [...byPerson.values()].map((rows) => {
      const sorted = [...rows].sort((a, b) => String(a.observation.observedDate ?? "").localeCompare(String(b.observation.observedDate ?? "")));
      return { ...sorted[sorted.length - 1], firstObserved: sorted[0].observation.observedDate, observationCount: rows.length };
    });
  }
  const summary = [...plan.values()].map((entry) => ({ sheet: entry.sheet, committeeName: entry.committeeName, committeeId: entry.committeeId, createsCommittee: entry.create, newMembers: entry.rows.length, linkedToPeople: entry.rows.filter((row) => row.personId).length }));
  const result = { dryRun, committees: summary, newMembers: summary.reduce((n, s) => n + s.newMembers, 0), skippedSheets: Object.fromEntries(skippedSheets), createsCommittees: summary.filter((s) => s.createsCommittee).length };
  if (dryRun) return result;
  for (const entry of plan.values()) {
    if (entry.create && !args.createMissingCommittees) continue;
    let committeeId = entry.committeeId;
    if (!committeeId) {
      committeeId = await ctx.db.insert("committees", { societyId: args.societyId, name: entry.sheet, description: `Created from the "${entry.sheet}" roster sheet. Confirm its mandate, cadence and status.`, cadence: "Unknown", color: "#64748b", status: "NeedsReview", bodyKey: sheetKey(entry.sheet), createdAtISO: now() });
    }
    for (const row of entry.rows) {
      const { termStart, termEnd } = observationTerm(row.observation);
      if (row.personId) {
        const person = await ctx.db.get(row.personId, "peopleDirectory");
        if (!person || (person.societyId && person.societyId !== args.societyId)) row.personId = undefined;
      }
      await ctx.db.insert("committeeMembers", {
        committeeId, societyId: args.societyId, name: row.observation.personName,
        role: row.observation.roleTitle && !/^[+()\d\s.-]{7,}$/.test(row.observation.roleTitle) ? row.observation.roleTitle : "Member",
        ...(row.personId ? { personId: row.personId } : {}),
        ...(row.seat.organizationName && !/^public$/i.test(row.seat.organizationName) ? { representedOrganization: row.seat.organizationName } : {}),
        joinedAt: termStart ?? row.firstObserved ?? row.observation.observedDate ?? "",
        ...(termEnd ? { leftAt: termEnd } : {}),
        reviewStatus: "pending", sourceSeatId: row.seat._id, sourceObservationId: row.observation.id,
        ...(row.observation.observedDate ? { observedDate: row.observation.observedDate } : {}),
        sourceReference: row.observation.sourceReference,
      });
    }
    for (const seatId of new Set(entry.rows.map((row) => row.seat._id))) {
      const seat = entry.rows.find((row) => row.seat._id === seatId)!.seat;
      if (!seat.committeeId) await ctx.db.patch(seatId, { committeeId, updatedAtISO: now() });
    }
  }
  await ctx.db.insert("activity", { societyId: args.societyId, actor: "You", entityType: "committee", subjectId: args.societyId, entityId: args.societyId, action: "rosters_built", summary: `Built pending committee rosters from roster sheets (${result.newMembers} members)`, createdAtISO: now() });
  return result;
}

/* --------------------------------- P16 ---------------------------------- */

export async function rosterSuggestions(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requirePermissionPortable(ctx, societyId, "directors:read");
  await requirePermissionPortable(ctx, societyId, "members:read");
  const directors = await ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const rows = (await seatPeople(ctx, societyId)).filter((row) => row.sheet && BOARD_SHEET.test(row.sheet) && row.observation.kind !== "staff");
  const people = new Map<string, any>();
  for (const row of rows) if (row.personId && !people.has(row.personId)) people.set(row.personId, await ctx.db.get(row.personId, "peopleDirectory"));
  return rows.map((row) => {
    const name = normalizeSearchName(row.observation.personName);
    const director = directors.find((d) => (row.personId && d.directoryPersonId === row.personId) || normalizeSearchName(`${d.firstName} ${d.lastName}`) === name);
    const { termStart, termEnd } = observationTerm(row.observation);
    return {
      seatId: row.seat._id, observationId: row.observation.id, sheet: row.sheet, organizationName: row.seat.organizationName,
      personName: row.observation.personName, personId: row.personId, personFullName: row.personId ? people.get(row.personId)?.fullName : undefined,
      roleTitle: row.observation.roleTitle, observedDate: row.observation.observedDate, termStart, termEnd,
      sourceUrl: row.observation.sourceUrl, sourceReference: row.observation.sourceReference,
      directorId: director?._id, directorStatus: director?.status,
    };
  }).sort((a, b) => String(b.observedDate ?? "").localeCompare(String(a.observedDate ?? "")) || a.personName.localeCompare(b.personName));
}

export async function promoteRosterObservation(ctx: PortableMutationCtx, args: { seatId: string; observationId: string; termStart?: string; position?: string }) {
  const seat = await requireOwnedRow(ctx, "organizationSeats", args.seatId);
  const societyId = String(seat.societyId);
  await requirePermissionPortable(ctx, societyId, "directors:write");
  const observation = (seat.observations ?? []).find((o: any) => o.id === args.observationId && !o.supersededById);
  if (!observation?.personName) throw new Error("Roster observation not found.");
  const suggestion = (await rosterSuggestions(ctx, { societyId })).find((row) => row.seatId === args.seatId && row.observationId === args.observationId);
  if (suggestion?.directorId) throw new Error(`${observation.personName} is already in the director register.`);
  const person = suggestion?.personId ? await getOwned(ctx, "peopleDirectory", suggestion.personId, societyId).catch(() => null) : null;
  const [firstName, lastName] = splitDirectoryName(person ?? { fullName: observation.personName });
  const { termStart, termEnd } = observationTerm(observation);
  const start = args.termStart || termStart || observation.observedDate || "";
  return ctx.db.insert("directors", {
    societyId, firstName, lastName,
    ...(person ? { directoryPersonId: person._id } : {}),
    position: args.position?.trim() || (observation.roleTitle && !/^[+()\d\s.-]{7,}$/.test(observation.roleTitle) ? observation.roleTitle : "Director"),
    isBCResident: false, termStart: start, ...(termEnd ? { termEnd } : {}), consentOnFile: false, status: "NeedsReview",
    notes: `Promoted from the ${seatRosterSheet(seat) ?? "board"} roster observation (${seat.organizationName}; observed ${observation.observedDate ?? "date unknown"}; ${observation.sourceReference}). Confirm the election or appointment, term, consent and residency before setting it Active.`,
  });
}
