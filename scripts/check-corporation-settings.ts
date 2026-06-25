import assert from "node:assert/strict";
import {
  ComplianceSettings,
  DerivedDeadline,
  nextAgmDate,
  nextFiscalYearEnd,
  nextAnnualReportDueDate,
  deriveComplianceDeadlines,
  isLeapYear,
  daysInMonth,
} from "../shared/corporationSettings";

// --- nextAgmDate basics ----------------------------------------------------
{
  const settings: ComplianceSettings = { agmMonth: 6, agmDay: 15 };
  assert.equal(nextAgmDate(settings, "2026-01-01"), "2026-06-15", "AGM later this year");
  assert.equal(nextAgmDate(settings, "2026-06-15"), "2026-06-15", "AGM on the day (inclusive)");
  assert.equal(nextAgmDate(settings, "2026-07-01"), "2027-06-15", "AGM rolls to next year");
  assert.equal(nextAgmDate(settings, "2026-06-16T10:00:00Z"), "2027-06-15", "ISO with time, day after");
}

// --- nextAgmDate missing config -> null ------------------------------------
{
  assert.equal(nextAgmDate({}, "2026-01-01"), null, "no agmMonth/agmDay -> null");
  assert.equal(nextAgmDate({ agmMonth: 6 }, "2026-01-01"), null, "missing agmDay -> null");
  assert.equal(nextAgmDate({ agmDay: 15 }, "2026-01-01"), null, "missing agmMonth -> null");
  assert.equal(nextAgmDate({ agmMonth: 13, agmDay: 1 }, "2026-01-01"), null, "bad month -> null");
}

// --- clamp invalid day (Feb 31 -> Feb 28 / 29) -----------------------------
{
  const feb31: ComplianceSettings = { agmMonth: 2, agmDay: 31 };
  // 2026 is not a leap year -> Feb 28.
  assert.equal(nextAgmDate(feb31, "2026-01-01"), "2026-02-28", "Feb 31 clamps to Feb 28 (non-leap)");
  // 2028 is a leap year -> Feb 29.
  assert.equal(nextAgmDate(feb31, "2028-01-01"), "2028-02-29", "Feb 31 clamps to Feb 29 (leap)");
  // From after Feb 2027 (non-leap) rolling into Feb 2028 (leap).
  assert.equal(nextAgmDate(feb31, "2027-03-01"), "2028-02-29", "rollover + clamp to leap day");
}

// --- leap-year helpers -----------------------------------------------------
{
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
}

// --- nextFiscalYearEnd -----------------------------------------------------
{
  const dec31: ComplianceSettings = { fiscalYearEnd: "12-31" };
  assert.equal(nextFiscalYearEnd(dec31, "2026-01-01"), "2026-12-31", "FYE 12-31 same year");
  assert.equal(nextFiscalYearEnd(dec31, "2026-12-31"), "2026-12-31", "FYE on the day inclusive");
  assert.equal(nextFiscalYearEnd(dec31, "2027-01-01"), "2027-12-31", "FYE next year");

  const feb29: ComplianceSettings = { fiscalYearEnd: "02-29" };
  // 2026 non-leap -> clamp to Feb 28.
  assert.equal(nextFiscalYearEnd(feb29, "2026-01-01"), "2026-02-28", "FYE 02-29 clamps non-leap");
  assert.equal(nextFiscalYearEnd(feb29, "2028-01-01"), "2028-02-29", "FYE 02-29 leap year");

  assert.equal(nextFiscalYearEnd({}, "2026-01-01"), null, "missing FYE -> null");
  assert.equal(nextFiscalYearEnd({ fiscalYearEnd: "bad" }, "2026-01-01"), null, "malformed FYE -> null");
}

// --- nextAnnualReportDueDate: anniversary preferred, AGM fallback ----------
{
  const withAnniv: ComplianceSettings = {
    anniversaryDate: "2020-03-10",
    agmMonth: 6,
    agmDay: 15,
  };
  assert.equal(
    nextAnnualReportDueDate(withAnniv, "2026-01-01"),
    "2026-03-10",
    "uses anniversary month-day when present",
  );
  assert.equal(
    nextAnnualReportDueDate(withAnniv, "2026-04-01"),
    "2027-03-10",
    "anniversary rolls over",
  );

  const noAnniv: ComplianceSettings = { agmMonth: 6, agmDay: 15 };
  assert.equal(
    nextAnnualReportDueDate(noAnniv, "2026-01-01"),
    "2026-06-15",
    "falls back to nextAgmDate when no anniversary",
  );

  assert.equal(nextAnnualReportDueDate({}, "2026-01-01"), null, "no anniversary or AGM -> null");
}

// --- deriveComplianceDeadlines ---------------------------------------------
function isValidISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

{
  const full: ComplianceSettings = {
    agmMonth: 6,
    agmDay: 15,
    fiscalYearEnd: "12-31",
    anniversaryDate: "2020-03-10",
  };
  const deadlines = deriveComplianceDeadlines(full, "2026-01-01");
  const byKey = new Map(deadlines.map((d: DerivedDeadline) => [d.key, d]));

  assert.ok(byKey.has("agm"), "has AGM deadline");
  assert.ok(byKey.has("fiscal-year-end"), "has financial deadline");
  assert.ok(byKey.has("annual-report"), "has annual-report deadline");

  assert.equal(byKey.get("agm")!.category, "agm");
  assert.equal(byKey.get("fiscal-year-end")!.category, "financial");
  assert.equal(byKey.get("annual-report")!.category, "annual-report");

  assert.equal(byKey.get("agm")!.dueDate, "2026-06-15");
  assert.equal(byKey.get("fiscal-year-end")!.dueDate, "2026-12-31");
  assert.equal(byKey.get("annual-report")!.dueDate, "2026-03-10");

  for (const d of deadlines) {
    assert.ok(isValidISODate(d.dueDate), `valid ISO date for ${d.key}: ${d.dueDate}`);
    assert.ok(typeof d.key === "string" && d.key.length > 0, "stable non-empty key");
    assert.ok(typeof d.title === "string" && d.title.length > 0, "non-empty title");
  }

  // Stable keys: deriving again yields the same keys in the same order.
  const again = deriveComplianceDeadlines(full, "2026-01-01");
  assert.deepEqual(
    again.map((d) => d.key),
    deadlines.map((d) => d.key),
    "stable keys across calls",
  );
}

// --- waivePrepFinancials skips annual-report -------------------------------
{
  const base: ComplianceSettings = {
    agmMonth: 6,
    agmDay: 15,
    fiscalYearEnd: "12-31",
    anniversaryDate: "2020-03-10",
  };
  const waived = deriveComplianceDeadlines({ ...base, waivePrepFinancials: true }, "2026-01-01");
  const waivedKeys = waived.map((d) => d.key);
  assert.ok(waivedKeys.includes("agm"), "AGM still present when waived");
  assert.ok(waivedKeys.includes("fiscal-year-end"), "financial still present when waived");
  assert.ok(!waivedKeys.includes("annual-report"), "annual-report skipped when waivePrepFinancials");

  const notWaived = deriveComplianceDeadlines({ ...base, waivePrepFinancials: false }, "2026-01-01");
  assert.ok(
    notWaived.map((d) => d.key).includes("annual-report"),
    "annual-report present when not waived",
  );
}

// --- partial settings only emit available deadlines ------------------------
{
  const onlyFye = deriveComplianceDeadlines({ fiscalYearEnd: "09-30" }, "2026-01-01");
  assert.deepEqual(onlyFye.map((d) => d.key), ["fiscal-year-end"], "only FYE config -> only FYE deadline");

  const empty = deriveComplianceDeadlines({}, "2026-01-01");
  assert.deepEqual(empty, [], "no config -> no deadlines");
}

console.log("OK corporation-settings");
