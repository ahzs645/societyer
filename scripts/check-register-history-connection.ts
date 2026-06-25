import assert from "node:assert/strict";

import { roleHoldersAsOf, type IntervalRow } from "../shared/registerHistory";
import { deriveSignificanceStatus, type SignificantIndividual } from "../shared/significantIndividuals";
import { deriveComplianceDeadlines, type ComplianceSettings } from "../shared/corporationSettings";

/**
 * Connection test: exercises the exact data transformations the thin Convex
 * wrappers (convex/registerHistory.ts, convex/corporationSettings.ts) perform
 * over representative roleHolders / societies rows. The Convex handlers only
 * load rows and delegate to these pure functions, so this covers the wired
 * behaviour end-to-end without a live backend.
 */

// --- roleHolders rows as stored by the existing schema ------------------------
const roleHolders: IntervalRow[] = [
  { _id: "rh1", roleType: "director", fullName: "Avery Chen", startDate: "2020-03-01", endDate: "2023-06-15" },
  { _id: "rh2", roleType: "director", fullName: "Morgan Patel", startDate: "2022-01-10", endDate: null },
  { _id: "rh3", roleType: "officer", fullName: "Sam Lee", startDate: "2021-05-01", endDate: null },
  { _id: "rh4", roleType: "controller", fullName: "Jordan Vale", startDate: "2019-01-01", endDate: "2024-02-01", dateOfBirth: "1980-04-04", significanceReason: "Holds >25% of votes" },
];

// directorsAsOf("2021-01-01") → only Avery (Morgan starts 2022)
const dirs2021 = roleHoldersAsOf(roleHolders, "2021-01-01", "director");
assert.deepEqual(dirs2021.map((r) => r.fullName), ["Avery Chen"]);

// directorsAsOf("2022-06-01") → both Avery and Morgan
const dirs2022 = roleHoldersAsOf(roleHolders, "2022-06-01", "director");
assert.deepEqual(dirs2022.map((r) => r.fullName).sort(), ["Avery Chen", "Morgan Patel"]);

// directorsAsOf("2024-01-01") → only Morgan (Avery's term ended 2023-06-15)
const dirs2024 = roleHoldersAsOf(roleHolders, "2024-01-01", "director");
assert.deepEqual(dirs2024.map((r) => r.fullName), ["Morgan Patel"]);

// --- significantIndividualsAsOf transformation --------------------------------
const controllers = roleHolders.filter((r) => r.roleType === "controller");
const mapped = controllers.map((row) => {
  const si: SignificantIndividual = {
    name: String(row.fullName ?? ""),
    dateOfBirth: (row.dateOfBirth as string) ?? undefined,
    becameSignificantOn: String(row.startDate ?? ""),
    ceasedSignificantOn: (row.endDate as string) ?? null,
    reason: String(row.significanceReason ?? ""),
  };
  return { ...si, status: deriveSignificanceStatus(si, "2021-01-01") };
});
assert.equal(mapped[0].status, "current"); // significant 2019..2024, current at 2021
assert.equal(mapped[0].reason, "Holds >25% of votes");
// former once past the cease date
assert.equal(deriveSignificanceStatus({ ...mapped[0], ceasedSignificantOn: "2024-02-01", becameSignificantOn: "2019-01-01" }, "2024-06-01"), "former");

// --- complianceDeadlines transformation (existing society fields) -------------
const settings: ComplianceSettings = { fiscalYearEnd: "12-31", anniversaryDate: "2018-09-20" };
const deadlines = deriveComplianceDeadlines(settings, "2026-01-01");
const keys = deadlines.map((d) => d.key).sort();
assert.ok(keys.includes("fiscal-year-end"));
assert.ok(keys.includes("annual-report"));
for (const d of deadlines) assert.match(d.dueDate, /^\d{4}-\d{2}-\d{2}$/);

console.log("OK register-history-connection");
