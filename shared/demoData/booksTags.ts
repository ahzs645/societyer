/**
 * Demo data for transaction line items and tags: the workspace's tag groups
 * (Program, Grant, Event), a few split bank lines and tagged lines, and the
 * review state of the feed.
 *
 * Shared by the in-browser demo (src/lib/staticConvexFixtures.ts, fixed ids)
 * and the server seed (shared/functions/seed.ts, real ids), like
 * financeWorkflows.ts. Layered onto the generated bank feed after the finance
 * workflows: it only adds `lines`, `tagIds`, manual provenance on the split
 * lines and `reviewedAtISO`; amounts, dates and accounts never change, so
 * balances and statement fingerprints stay as they were.
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */
import { splitEvenlyCents, type TransactionLine } from "../transactionLines";

export type DemoBooksTagIdKind = "tagGroup" | "tag";

export type DemoBooksTagRefs = {
  societyId: string;
  idFor: (kind: DemoBooksTagIdKind, key: string) => string;
};

type Txn = Record<string, any>;

const CREATED_AT = "2025-12-18T18:30:00.000Z";

export const DEMO_TAG_GROUPS = [
  { key: "program", name: "Program", color: "purple", tags: [
    { key: "youth_mentoring", name: "Youth mentoring" },
    { key: "community_garden", name: "Community garden" },
    { key: "arts_nights", name: "Arts nights" },
  ] },
  { key: "grant", name: "Grant", color: "teal", tags: [
    { key: "harbour_2026", name: "Harbour Foundation 2026" },
    { key: "city_neighbourhood", name: "City neighbourhood grant" },
  ] },
  { key: "event", name: "Event", color: "amber", tags: [
    { key: "fall_gala", name: "Fall gala" },
  ] },
] as const;

export type DemoTagKey = (typeof DEMO_TAG_GROUPS)[number]["tags"][number]["key"];

export function demoFinanceTagGroups(refs: DemoBooksTagRefs) {
  return DEMO_TAG_GROUPS.map((group, index) => ({
    _id: refs.idFor("tagGroup", group.key),
    societyId: refs.societyId,
    name: group.name,
    color: group.color,
    sortOrder: index + 1,
    createdAtISO: CREATED_AT,
    updatedAtISO: CREATED_AT,
  }));
}

export function demoFinanceTags(refs: DemoBooksTagRefs) {
  return DEMO_TAG_GROUPS.flatMap((group) =>
    group.tags.map((tag, index) => ({
      _id: refs.idFor("tag", tag.key),
      societyId: refs.societyId,
      groupId: refs.idFor("tagGroup", group.key),
      name: tag.name,
      sortOrder: index + 1,
      createdAtISO: CREATED_AT,
      updatedAtISO: CREATED_AT,
    })),
  );
}

const feedKeyOf = (txn: Txn) => {
  const externalId = String(txn.externalId ?? "");
  return externalId.startsWith("feed-") ? externalId.slice("feed-".length) : "";
};
const byDate = (a: Txn, b: Txn) => String(a.date).localeCompare(String(b.date)) || feedKeyOf(a).localeCompare(feedKeyOf(b));

/**
 * Splits, tags and review state on the feed (mutating the rows in place).
 * `tagId` resolves a demo tag key to the id it is stored under.
 *
 *  - The latest hall rent is split three ways: the office share stays in
 *    Facilities and the two program rooms go to Program delivery, tagged
 *    Youth mentoring and Arts nights (reviewed).
 *  - The latest program-registration payout is split evenly between Youth
 *    mentoring and Community garden (still to review).
 *  - Fall gala lines carry the Event tag; 2026 restricted program spending
 *    carries the Harbour Foundation grant and a program; 2026 grocery runs
 *    for the community fridge are Community garden on the city grant; art
 *    supplies are Arts nights.
 *  - Lines cleared on a reconciled statement count as reviewed.
 */
export function applyDemoLinesAndTags(transactions: Txn[], tagId: (key: DemoTagKey) => string) {
  const feed = transactions.filter((txn) => feedKeyOf(txn)).sort(byDate);
  const latest = (prefix: string) => feed.filter((txn) => feedKeyOf(txn).startsWith(prefix) && txn.status !== "pending").at(-1);
  const line = (id: string, amountCents: number, fields: Omit<TransactionLine, "id" | "amountCents">): TransactionLine => ({ id, amountCents, ...fields });

  for (const txn of feed) {
    if (!txn.reviewedAtISO && txn.reconciledAtISO) txn.reviewedAtISO = txn.reconciledAtISO;
  }

  const rent = latest("rent-");
  if (rent && rent.amountCents === -180000) {
    rent.lines = [
      line("line-1", -108000, { category: "Facilities", memo: "Office and storage room share" }),
      line("line-2", -43200, { category: "Program delivery", memo: "Program room, youth mentoring", tagIds: [tagId("youth_mentoring")] }),
      line("line-3", -28800, { category: "Program delivery", memo: "Program room, arts nights", tagIds: [tagId("arts_nights")] }),
    ];
    rent.category = "Facilities";
    rent.categorizedBy = "manual";
    rent.reviewedAtISO = `${rent.date}T19:00:00.000Z`;
    delete rent.ruleId;
    delete rent.ruleApplication;
  }

  const registrations = latest("registrations-");
  if (registrations && registrations.amountCents > 1) {
    const [first, second] = splitEvenlyCents(registrations.amountCents, 2);
    registrations.lines = [
      line("line-1", first, { category: registrations.category ?? "Program fees", memo: "Youth mentoring sign-ups", tagIds: [tagId("youth_mentoring")] }),
      line("line-2", second, { category: registrations.category ?? "Program fees", memo: "Community garden plots", tagIds: [tagId("community_garden")] }),
    ];
    registrations.category = registrations.category ?? "Program fees";
    registrations.categorizedBy = "manual";
    delete registrations.ruleId;
    delete registrations.ruleApplication;
  }

  const programs = ["youth_mentoring", "community_garden", "arts_nights"] as const;
  let programIndex = 0;
  for (const txn of feed) {
    if (txn.lines) continue;
    const key = feedKeyOf(txn);
    if (key.startsWith("gala-")) {
      txn.tagIds = [tagId("fall_gala")];
    } else if (key.startsWith("program-") && txn.date >= "2026-01-01") {
      txn.tagIds = [tagId("harbour_2026"), tagId(programs[programIndex % programs.length])];
      programIndex += 1;
    } else if (txn.counterparty === "Greenway Market" && txn.date >= "2026-01-01") {
      txn.tagIds = [tagId("community_garden"), tagId("city_neighbourhood")];
    } else if (txn.counterparty === "Brushstroke Art Supply" && txn.amountCents < 0) {
      txn.tagIds = [tagId("arts_nights")];
    }
  }
}
