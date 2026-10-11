/**
 * Gate: governance dates on a late Vancouver evening, when the UTC day is
 * already tomorrow, and recording an AGM that was already held. Synthetic data.
 *
 * Run under TZ=America/Vancouver (set below before any Date is read).
 */
process.env.TZ = "America/Vancouver";
import assert from "node:assert/strict";
import { todayDateOnly } from "../shared/dateOnly";
import { isPastMeeting, newGeneralMeetingNoticeProblem, statusForNewMeeting } from "../src/features/meetings/lib/noticeWindow";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";

// 21:30 on Dec 31 in Vancouver is already Jan 1 in UTC.
const lateEvening = new Date("2026-12-31T21:30:00-08:00");
assert.equal(lateEvening.toISOString().slice(0, 10), "2027-01-01", "fixture: UTC is already tomorrow");
assert.equal(todayDateOnly(lateEvening), "2026-12-31");

// Recording an AGM that was already held (setting up an existing organization).
const october = new Date("2026-10-07T21:30:00-07:00");
assert.equal(isPastMeeting("2026-06-17T19:00", october), true);
assert.equal(newGeneralMeetingNoticeProblem("2026-06-17T19:00", 14, undefined, october), null, "a held AGM needs no notice from today");
assert.equal(statusForNewMeeting("2026-06-17T19:00", "Scheduled", october), "Held");
assert.equal(statusForNewMeeting("2026-06-17T19:00", "Cancelled", october), "Cancelled", "an explicit status is kept");
assert.equal(isPastMeeting("2026-10-07T23:00", october), false, "later today is not past");
assert.match(newGeneralMeetingNoticeProblem("2026-10-12T19:00", 14, undefined, october) ?? "", /at least 14 days/, "a future AGM still needs notice");
assert.equal(newGeneralMeetingNoticeProblem("2026-10-21T19:00", 14, undefined, october), null);
assert.equal(statusForNewMeeting("2026-11-01T19:00", "Scheduled", october), "Scheduled");

// Dashboard: a filing due today is not overdue, one due yesterday is.
const today = todayDateOnly();
const yesterday = todayDateOnly(new Date(Date.now() - 86_400_000));
const db = new MemoryDb({
  seed: {
    societies: [{ _id: "soc", name: "Synthetic Timezone Society", jurisdictionCode: "CA-BC", entityType: "society", isCharity: false, isMemberFunded: false }],
    users: [{ _id: "owner", societyId: "soc", role: "Owner", status: "Active", displayName: "Owner" }],
    filings: [
      { _id: "f-today", societyId: "soc", kind: "ChangeOfDirectors", dueDate: today, status: "Upcoming" },
      { _id: "f-late", societyId: "soc", kind: "ChangeOfAddress", dueDate: yesterday, status: "Upcoming" },
      { _id: "f-done", societyId: "soc", kind: "BCSocietyAnnualReport", dueDate: yesterday, filedAt: yesterday, status: "Filed" },
    ],
  },
});
const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: "owner", userId: "owner", societyId: "soc" }) }).registerAll(PORTABLE_FUNCTIONS);
const counts: any = await runtime.runQuery("dashboard:navCounts", { societyId: "soc" });
assert.equal(counts.overdueFilings, 1, "only the filing due yesterday is overdue");
const summary: any = await runtime.runQuery("dashboard:summary", { societyId: "soc" });
assert.deepEqual(summary.overdueFilings.map((row: any) => row._id), ["f-late"]);
assert.ok(summary.upcomingFilings.some((row: any) => row._id === "f-today"), "the filing due today is upcoming");

console.log("governance timezone checks passed");
