import assert from "node:assert/strict";

import {
  getLegalGuideRules,
  UNVERIFIED_COMMENCEMENT_CAVEAT,
  type LegalGuideTopic,
} from "../src/lib/jurisdictionGuideTracks";
import { JURISDICTION_GUIDE_PACK_JSON } from "../src/lib/jurisdictionGuidePackRegistry";
import { jurisdictionGuidePackSchema, type JurisdictionGuidePackV2 } from "../src/lib/jurisdictionGuideSchema";

// Meeting pages ask for guidance on the date a meeting was held. A rule's
// current-wording review date must never hide guidance for an earlier meeting.

const DAY = 24 * 60 * 60 * 1000;
const today = new Date().toISOString().slice(0, 10);

function* days(fromISO: string, toISO: string) {
  for (let t = Date.parse(`${fromISO}T00:00:00.000Z`); t <= Date.parse(`${toISO}T00:00:00.000Z`); t += DAY) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

function previousDay(iso: string) {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) - DAY).toISOString().slice(0, 10);
}

const coverage: { code: string; label: string; from: string; topics: LegalGuideTopic[] }[] = [
  // Former Society Act historical guide, then the Societies Act from 2016-11-28.
  { code: "CA-BC", label: "BC society", from: "2000-09-06", topics: ["quorum", "general_meeting_notice"] },
  { code: "CA-BC", label: "BC society (Societies Act)", from: "2016-11-28", topics: ["quorum", "general_meeting_notice", "agm_timing", "special_resolution", "electronic_participation", "proxy_voting"] },
  { code: "CA-FED-CBCA", label: "CBCA", from: "1975-12-15", topics: ["general_meeting_notice", "agm_timing", "special_resolution", "directors_quorum"] },
  // R.S.O. 1990, c. B.16 (the revision in force 1991-12-31).
  { code: "CA-ON-OBCA", label: "OBCA", from: "1991-12-31", topics: ["general_meeting_notice", "agm_timing", "special_resolution", "directors_quorum"] },
  { code: "CA-BC-BCA", label: "BC company", from: "2004-03-29", topics: ["general_meeting_notice", "agm_timing", "special_resolution", "quorum"] },
];

for (const { code, label, from, topics } of coverage) {
  let checked = 0;
  for (const dateISO of days(from, today)) {
    for (const topic of topics) {
      assert.ok(
        getLegalGuideRules({ jurisdictionCode: code, dateISO, topics: [topic] }).length > 0,
        `${label}: no ${topic} guidance for ${dateISO}`,
      );
    }
    checked += 1;
  }
  assert.ok(checked > 0, `${label}: date sweep did not run`);
}

// Corporate guides start at their Act's commencement; earlier dates have none.
for (const { code, from } of coverage.filter((entry) => entry.code !== "CA-BC")) {
  assert.deepEqual(
    getLegalGuideRules({ jurisdictionCode: code, dateISO: previousDay(from) }).map((rule) => rule.id),
    [],
    `${code}: no guidance before the governing Act commenced`,
  );
}

// Regression for the review: a meeting before the review date keeps its guidance.
assert.ok(getLegalGuideRules({ jurisdictionCode: "CA-BC", dateISO: "2025-06-01" }).length >= 15, "BC 2025 meetings keep the restored guide rules");
assert.ok(getLegalGuideRules({ jurisdictionCode: "CA-FED-CBCA", dateISO: "2025-06-01" }).length > 0, "CBCA 2025 meetings keep guidance");

// No two versions of one rule may overlap, and a successor takes over exactly
// where its predecessor ends. Versions share a stable key apart from a
// ".2016"/".current" suffix, and are linked by supersedes/supersededBy.
const versionFamily = (stableKey: string) => stableKey.replace(/\.(current|\d{4})$/, "");
type RawRule = JurisdictionGuidePackV2["rules"][number];
const interval = (rule: RawRule) => ({
  from: Date.parse(rule.validity.effectiveFrom ?? rule.validity.notBefore ?? "0000-01-01"),
  to: rule.validity.effectiveTo ? Date.parse(rule.validity.effectiveTo) : Number.POSITIVE_INFINITY,
});
let versionedFamilies = 0;
for (const pack of JURISDICTION_GUIDE_PACK_JSON.map((raw) => jurisdictionGuidePackSchema.parse(raw))) {
  const byId = new Map(pack.rules.map((rule) => [rule.ruleId, rule]));
  const families = new Map<string, RawRule[]>();
  for (const rule of pack.rules) {
    const key = versionFamily(rule.stableKey);
    families.set(key, [...(families.get(key) ?? []), rule]);
  }
  for (const [family, versions] of families) {
    if (versions.length < 2) continue;
    versionedFamilies += 1;
    const sorted = [...versions].sort((a, b) => interval(a).from - interval(b).from);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const next = sorted[index];
      assert.ok(interval(previous).to <= interval(next).from, `${pack.packId} ${family}: ${previous.ruleId} overlaps ${next.ruleId}`);
      assert.equal(interval(previous).to, interval(next).from, `${pack.packId} ${family}: gap between ${previous.ruleId} and ${next.ruleId}`);
      assert.deepEqual(next.supersedes, [previous.ruleId], `${next.ruleId} must name its predecessor`);
      assert.deepEqual(previous.supersededBy, [next.ruleId], `${previous.ruleId} must name its successor`);
    }
  }
  for (const rule of pack.rules) {
    for (const successorId of rule.supersededBy ?? []) {
      const successor = byId.get(successorId);
      assert.ok(successor, `${rule.ruleId}: unknown successor ${successorId}`);
      assert.equal(rule.validity.effectiveTo, successor.validity.effectiveFrom, `${rule.ruleId} must hand over to ${successorId} on its verified commencement`);
    }
  }
}
assert.ok(versionedFamilies >= 3, "expected the Societies Act notice, electronic-participation and proxy version families");

// The specific Societies Act predecessors hand over with no gap or overlap.
for (const [predecessor, successor, handover] of [
  ["ca-bc-societies-act-general-notice-2016", "ca-bc-societies-act-general-notice-current", "2023-05-04"],
  ["ca-bc-societies-act-electronic-participation-2016", "ca-bc-societies-act-electronic-participation-current", "2021-05-20"],
  ["ca-bc-societies-act-proxies-2016", "ca-bc-societies-act-proxies-current", "2021-10-28"],
] as const) {
  const before = getLegalGuideRules({ jurisdictionCode: "CA-BC", dateISO: previousDay(handover) }).map((rule) => rule.id);
  const on = getLegalGuideRules({ jurisdictionCode: "CA-BC", dateISO: handover }).map((rule) => rule.id);
  assert.ok(before.includes(predecessor) && !before.includes(successor), `${predecessor} applies the day before ${handover}`);
  assert.ok(on.includes(successor) && !on.includes(predecessor), `${successor} applies from ${handover}`);
}
// The former Society Act guide hands over to the Societies Act on 2016-11-28.
const lastFormer = getLegalGuideRules({ jurisdictionCode: "CA-BC", dateISO: "2016-11-27" }).map((rule) => rule.id);
const firstCurrent = getLegalGuideRules({ jurisdictionCode: "CA-BC", dateISO: "2016-11-28" }).map((rule) => rule.id);
assert.deepEqual(lastFormer, ["ca-bc-former-society-act-pre-2016"]);
assert.ok(!firstCurrent.includes("ca-bc-former-society-act-pre-2016"));

// Rules without a verified commencement remain visible for earlier dates, with
// a caveat; recently commenced regimes stay hidden before they began.
const earlierBc = getLegalGuideRules({ jurisdictionCode: "CA-BC", dateISO: "2020-06-01", topics: ["annual_report"] });
const annualReport = earlierBc.find((rule) => rule.id === "ca-bc-bc-soc-annual-report");
assert.ok(annualReport, "unverified Societies Act rules are shown for earlier dates");
assert.equal(annualReport.dateCaveatText, UNVERIFIED_COMMENCEMENT_CAVEAT);
assert.ok(annualReport.caveatText?.startsWith(UNVERIFIED_COMMENCEMENT_CAVEAT));
const reviewedToday = getLegalGuideRules({ jurisdictionCode: "CA-BC", dateISO: "2026-10-11", topics: ["annual_report"] }).find((rule) => rule.id === "ca-bc-bc-soc-annual-report");
assert.equal(reviewedToday?.dateCaveatText, undefined, "no caveat on or after the review date");
for (const [code, dateISO, ruleId] of [
  ["CA-FED-CBCA", "2019-06-12", "ca-fed-cbca-cbca-isc"],
  ["CA-FED-CBCA", "2024-01-21", "ca-fed-cbca-cbca-isc-filing"],
  ["CA-BC-BCA", "2020-09-30", "ca-bc-bca-transparency"],
  ["CA-BC-BCA", "2026-01-11", "ca-bc-bca-bc-bca-transparency-exemptions"],
  ["CA-ON-OBCA", "2022-12-31", "ca-on-obca-obca-isc"],
  ["CA-ON-OBCA", "2021-10-18", "ca-on-obca-on-cia-annual-return-regulation"],
] as const) {
  assert.ok(!getLegalGuideRules({ jurisdictionCode: code, dateISO }).some((rule) => rule.id === ruleId), `${ruleId} is not shown before it commenced (${dateISO})`);
}


console.log("Guide rule continuity checks passed: core meeting topics stay populated from each Act's commencement to today, versions hand over without gaps or overlap, and unverified commencements are disclosed.");
