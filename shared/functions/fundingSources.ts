/**
 * PORTABLE FUNCTIONS: the funding-sources domain (list / rollup /
 * applyOtenFeeStructure).
 *
 * Pure `ctx.db` reads and writes across the funding-source register, its events,
 * grants, receipts, member billing, and the membership fee-period table. Each
 * handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle. The role-gated handlers (upsertSource / removeSource /
 * upsertEvent / removeEvent / importStudentLevy) stay on Convex — they call
 * `requireRole`, a server-side helper.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

function inRange(date: string | undefined, from?: string, to?: string) {
  if (!date) return true;
  const day = date.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function annualizedCents(amountCents: number, interval: string) {
  if (interval === "month") return amountCents * 12;
  if (interval === "semester") return amountCents * 2;
  if (interval === "quarter") return amountCents * 4;
  if (interval === "week") return amountCents * 52;
  if (interval === "year") return amountCents;
  return amountCents;
}

function makeRollupRow(name: string, sourceType: string) {
  return {
    key: `${sourceType}:${name}`.toLowerCase(),
    name,
    sourceType,
    plannedCents: 0,
    committedCents: 0,
    receivedCents: 0,
    lastActivityDate: undefined as string | undefined,
    sourceCount: 0,
    observedFrom: [] as string[],
    restrictedPurposes: [] as string[],
    collectionAgents: [] as string[],
    memberDisclosureLevels: [] as string[],
    collectionFrequencies: [] as string[],
    collectionScheduleNotes: [] as string[],
    nextExpectedCollectionDate: undefined as string | undefined,
    estimatedMemberCount: undefined as number | undefined,
  };
}

function addActivity(row: any, date?: string) {
  if (!date) return;
  if (!row.lastActivityDate || date > row.lastActivityDate) row.lastActivityDate = date;
}

function addObservedFrom(row: any, label: string) {
  if (!row.observedFrom.includes(label)) row.observedFrom.push(label);
}

function addRestrictedPurpose(row: any, purpose?: string) {
  if (purpose && !row.restrictedPurposes.includes(purpose)) row.restrictedPurposes.push(purpose);
}

function addCollectionAgent(row: any, agent?: string) {
  if (agent && !row.collectionAgents.includes(agent)) row.collectionAgents.push(agent);
}

function addMemberDisclosureLevel(row: any, level?: string) {
  if (level && !row.memberDisclosureLevels.includes(level)) row.memberDisclosureLevels.push(level);
}

function addCollectionFrequency(row: any, frequency?: string) {
  if (frequency && !row.collectionFrequencies.includes(frequency)) row.collectionFrequencies.push(frequency);
}

function addCollectionScheduleNote(row: any, note?: string) {
  if (note && !row.collectionScheduleNotes.includes(note)) row.collectionScheduleNotes.push(note);
}

function addNextExpectedCollectionDate(row: any, date?: string) {
  if (!date) return;
  if (!row.nextExpectedCollectionDate || date < row.nextExpectedCollectionDate) {
    row.nextExpectedCollectionDate = date;
  }
}

function getRollupGroup(groups: Map<string, any>, name: string, sourceType: string) {
  const key = `${sourceType}:${name}`.toLowerCase();
  let row = groups.get(key);
  if (!row) {
    row = makeRollupRow(name, sourceType);
    groups.set(key, row);
  }
  return row;
}

export async function fundingSourcesList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const [sources, events, grants, members] = await Promise.all([
    ctx.db
      .query("fundingSources")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("fundingSourceEvents")
      .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);
  const eventsBySource = new Map<string, any[]>();
  for (const event of events) {
    const key = String(event.sourceId);
    eventsBySource.set(key, [...(eventsBySource.get(key) ?? []), event]);
  }
  const grantById = new Map(grants.map((grant: any) => [String(grant._id), grant]));
  const memberById = new Map(members.map((member: any) => [String(member._id), member]));
  return sources
    .map((source: any) => {
      const sourceEvents = (eventsBySource.get(String(source._id)) ?? []).sort((a, b) => b.eventDate.localeCompare(a.eventDate));
      const receivedFromEventsCents = sourceEvents
        .filter((event) => event.kind === "Received")
        .reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
      const committedFromEventsCents = sourceEvents
        .filter((event) => event.kind === "Pledged" || event.kind === "Agreement")
        .reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
      const linkedGrant = source.linkedGrantId ? grantById.get(String(source.linkedGrantId)) : null;
      const linkedMember = source.linkedMemberId ? memberById.get(String(source.linkedMemberId)) : null;
      return {
        ...source,
        linkedGrantTitle: linkedGrant?.title,
        linkedMemberName: linkedMember ? `${linkedMember.firstName} ${linkedMember.lastName}` : undefined,
        events: sourceEvents,
        eventCount: sourceEvents.length,
        lastEventDate: sourceEvents[0]?.eventDate,
        committedTotalCents: (source.committedCents ?? 0) + committedFromEventsCents,
        receivedTotalCents: (source.receivedToDateCents ?? 0) + receivedFromEventsCents,
      };
    })
    .sort((a, b) => `${a.status}:${a.name}`.localeCompare(`${b.status}:${b.name}`));
}

export async function fundingSourcesRollup(
  ctx: PortableQueryCtx,
  { societyId, from, to }: { societyId: string; from?: string; to?: string },
) {
  const [sources, sourceEvents, grants, grantTransactions, receipts, subscriptions, plans] = await Promise.all([
    ctx.db
      .query("fundingSources")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("fundingSourceEvents")
      .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("grants")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("grantTransactions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("donationReceipts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("memberSubscriptions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("subscriptionPlans")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);

  const groups = new Map<string, any>();

  for (const source of sources) {
    const row = getRollupGroup(groups, source.name, source.sourceType);
    row.sourceCount += 1;
    row.plannedCents += source.expectedAnnualCents ?? 0;
    row.committedCents += source.committedCents ?? 0;
    row.receivedCents += source.receivedToDateCents ?? 0;
    addActivity(row, source.startDate);
    addObservedFrom(row, "register");
    addRestrictedPurpose(row, source.restrictedPurpose);
    addCollectionAgent(row, source.collectionAgentName);
    addMemberDisclosureLevel(row, source.memberDisclosureLevel);
    addCollectionFrequency(row, source.collectionFrequency);
    addCollectionScheduleNote(row, source.collectionScheduleNotes);
    addNextExpectedCollectionDate(row, source.nextExpectedCollectionDate);
    if (source.estimatedMemberCount != null) {
      row.estimatedMemberCount = (row.estimatedMemberCount ?? 0) + source.estimatedMemberCount;
    }
  }

  for (const event of sourceEvents.filter((event: any) => inRange(event.eventDate, from, to))) {
    const source = sources.find((row: any) => row._id === event.sourceId);
    if (!source) continue;
    const row = getRollupGroup(groups, source.name, source.sourceType);
    if (event.kind === "Received") row.receivedCents += event.amountCents ?? 0;
    if (event.kind === "Pledged" || event.kind === "Agreement") row.committedCents += event.amountCents ?? 0;
    addActivity(row, event.eventDate);
    addObservedFrom(row, "funding events");
    addMemberDisclosureLevel(row, event.attributionStatus);
    if (event.memberCount != null) {
      row.estimatedMemberCount = (row.estimatedMemberCount ?? 0) + event.memberCount;
    }
  }

  const grantTransactionsByGrant = new Map<string, any[]>();
  for (const txn of grantTransactions.filter((txn: any) => inRange(txn.date, from, to))) {
    const key = String(txn.grantId);
    grantTransactionsByGrant.set(key, [...(grantTransactionsByGrant.get(key) ?? []), txn]);
  }
  for (const grant of grants) {
    const row = getRollupGroup(groups, grant.funder, "Grant funder");
    const isAwarded = ["Awarded", "Active", "Closed"].includes(grant.status);
    row.committedCents += isAwarded ? grant.amountAwardedCents ?? 0 : 0;
    const inflowCents = (grantTransactionsByGrant.get(String(grant._id)) ?? [])
      .filter((txn: any) => txn.direction === "inflow")
      .reduce((sum: number, txn: any) => sum + (txn.amountCents ?? 0), 0);
    row.receivedCents += inflowCents;
    addActivity(row, grant.decisionAtISO ?? grant.submittedAtISO ?? grant.applicationDueDate ?? grant.startDate);
    addObservedFrom(row, "grants");
    addRestrictedPurpose(row, grant.restrictedPurpose);
  }

  for (const receipt of receipts.filter((receipt: any) => inRange(receipt.receivedOnISO ?? receipt.issuedAtISO, from, to))) {
    const row = getRollupGroup(groups, receipt.donorName, "Donor");
    row.receivedCents += receipt.amountCents ?? 0;
    addActivity(row, receipt.receivedOnISO ?? receipt.issuedAtISO);
    addObservedFrom(row, "receipts");
  }

  const planById = new Map(plans.map((plan: any) => [String(plan._id), plan]));
  for (const subscription of subscriptions.filter((sub: any) => sub.status !== "canceled")) {
    const plan = planById.get(String(subscription.planId));
    const row = getRollupGroup(groups, subscription.fullName, "Member dues");
    if (subscription.status === "active" && plan) {
      row.plannedCents += annualizedCents(plan.priceCents, plan.interval);
    }
    if (inRange(subscription.lastPaymentAtISO, from, to)) {
      row.receivedCents += subscription.lastPaymentCents ?? 0;
    }
    addActivity(row, subscription.lastPaymentAtISO ?? subscription.startedAtISO);
    addObservedFrom(row, "member billing");
  }

  const rows = Array.from(groups.values()).sort(
    (a, b) =>
      b.receivedCents - a.receivedCents ||
      b.committedCents - a.committedCents ||
      a.name.localeCompare(b.name),
  );
  return {
    rows,
    totalPlannedCents: rows.reduce((sum, row) => sum + row.plannedCents, 0),
    totalCommittedCents: rows.reduce((sum, row) => sum + row.committedCents, 0),
    totalReceivedCents: rows.reduce((sum, row) => sum + row.receivedCents, 0),
  };
}

const OTEN_SOCIETY_NAME = "Over the Edge Newspaper Society";
const OTEN_FUNDING_SOURCE_NAME = "OTEN student newspaper levy";

const OTEN_FEE_PERIODS = [
  {
    label: "OTEN student newspaper levy",
    membershipClass: "Undergraduate students",
    priceCents: 1133,
    effectiveFrom: "2018-09-01",
    effectiveTo: "2019-08-31",
    status: "retired",
    notes: "Observed CA$11.33 per charged semester in September 2018 and January 2019. Charged semesters are January and September only; May/summer is not charged in the observed records.",
  },
  {
    label: "OTEN student newspaper levy",
    membershipClass: "Undergraduate students",
    priceCents: 1163,
    effectiveFrom: "2019-09-01",
    effectiveTo: "2020-08-31",
    status: "retired",
    notes: "Observed CA$11.63 per charged semester in September 2019 and January 2020. Charged semesters are January and September only; May/summer is not charged in the observed records.",
  },
  {
    label: "OTEN student newspaper levy",
    membershipClass: "Undergraduate students",
    priceCents: 1193,
    effectiveFrom: "2020-09-01",
    effectiveTo: undefined,
    status: "active",
    notes: "Observed CA$11.93 per charged semester from September 2020 onward whenever the fee appears. Charged semesters are January and September only; May/summer is not charged in the observed records.",
  },
  {
    label: "OTEN graduate student levy",
    membershipClass: "Graduate students",
    priceCents: 1193,
    effectiveFrom: "2025-09-01",
    effectiveTo: undefined,
    status: "active",
    notes: "Graduate students began being charged starting September 2025. Same observed semester price as the OTEN levy: CA$11.93 per charged semester. May/summer is not charged in the observed records.",
  },
] as const;

function nextOtenCollectionDate() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  if (month < 9) return `${year}-09-01`;
  return `${year + 1}-01-01`;
}

export async function applyOtenFeeStructurePortable(
  ctx: PortableMutationCtx,
  args: { confirm: string; societyId?: string; societyName?: string },
) {
  if (args.confirm !== "apply-oten-fee-structure") {
    throw new Error('Pass confirm: "apply-oten-fee-structure" to apply the OTEN local fixture.');
  }

  const society =
    (args.societyId ? await ctx.db.get(args.societyId) : null) ??
    (await ctx.db
      .query("societies")
      .collect()
      .then((rows) => rows.find((row) => row.name === (args.societyName ?? OTEN_SOCIETY_NAME))));

  if (!society) {
    throw new Error(`Society not found: ${args.societyName ?? OTEN_SOCIETY_NAME}. Create/import the society first, then rerun this mutation.`);
  }

  const now = new Date().toISOString();
  const existingSources = await ctx.db
    .query("fundingSources")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  const existingSource = existingSources.find((source) => source.name === OTEN_FUNDING_SOURCE_NAME);
  const sourcePayload = {
    societyId: society._id,
    name: OTEN_FUNDING_SOURCE_NAME,
    sourceType: "Member dues",
    status: "Active",
    contactName: "UNBC student-fee remittance",
    collectionAgentName: "University of Northern British Columbia",
    collectionModel: "third_party",
    memberDisclosureLevel: "aggregate_amount",
    collectionFrequency: "semester",
    collectionScheduleNotes:
      "Charged only in January and September semesters. May/summer term is not charged in the observed records. Graduate students are included starting September 2025.",
    nextExpectedCollectionDate: nextOtenCollectionDate(),
    reconciliationCadence: "semester",
    currency: "CAD",
    startDate: "2018-09-01",
    notes:
      "OTEN fee structure from observed records: CA$11.33 in 2018 September and 2019 January; CA$11.63 in 2019 September and 2020 January; CA$11.93 from 2020 September onward when charged. Fee is a student newspaper levy remitted by UNBC, not a member-level subscription list.",
    updatedAtISO: now,
  };

  const sourceId = existingSource
    ? (await ctx.db.patch(existingSource._id, sourcePayload), existingSource._id)
    : await ctx.db.insert("fundingSources", { ...sourcePayload, createdAtISO: now });

  const existingPeriods = await ctx.db
    .query("membershipFeePeriods")
    .withIndex("by_society", (q) => q.eq("societyId", society._id))
    .collect();
  let createdFeePeriods = 0;
  let updatedFeePeriods = 0;

  for (const period of OTEN_FEE_PERIODS) {
    const existing = existingPeriods.find(
      (row) =>
        row.label === period.label &&
        row.membershipClass === period.membershipClass &&
        row.effectiveFrom === period.effectiveFrom,
    );
    const payload = {
      societyId: society._id,
      planId: undefined,
      membershipClass: period.membershipClass,
      label: period.label,
      priceCents: period.priceCents,
      currency: "CAD",
      interval: "semester",
      effectiveFrom: period.effectiveFrom,
      effectiveTo: period.effectiveTo,
      status: period.status,
      notes: period.notes,
      updatedAtISO: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      updatedFeePeriods += 1;
    } else {
      await ctx.db.insert("membershipFeePeriods", { ...payload, createdAtISO: now });
      createdFeePeriods += 1;
    }
  }

  return {
    ok: true,
    societyId: society._id,
    societyName: society.name,
    fundingSourceId: sourceId,
    fundingSourceAction: existingSource ? "updated" : "created",
    createdFeePeriods,
    updatedFeePeriods,
    chargedTerms: ["January", "September"],
    excludedTerms: ["May", "Summer"],
    graduateStudentsChargedFrom: "2025-09-01",
  };
}
