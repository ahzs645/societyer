// Notification settings: per-person channel × kind switches, role-gated kinds,
// workspace alert thresholds and the digests. The checks run the real portable
// handlers (with the application action policy) on a MemoryDb, so they cover
// what both the server and the in-browser workspace do.
//
//   npx tsx scripts/check-notification-settings.ts

import assert from "node:assert/strict";
import { MemoryDb, PortableRuntime, makeCapabilities } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { buildDigestPlan, scanSocietyAlerts } from "../shared/functions/notifications";
import { preferenceKindFor, prefAllows, resolveNotificationRules } from "../shared/notificationCatalog";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (offsetDays: number) => new Date(now + offsetDays * DAY).toISOString();
const date = (offsetDays: number) => iso(offsetDays).slice(0, 10);

const db = new MemoryDb();
const caps = makeCapabilities({});
const as = (userId: string, societyId: string) =>
  new PortableRuntime({
    db,
    capabilities: caps,
    principalProvider: () => ({ kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `user:${userId}`, userId, societyId }),
  }).registerAll(PORTABLE_FUNCTIONS);

// --- Fixture: one workspace with an owner, a director (no finance edit) and a member.
const today = new Date(now).toISOString().slice(0, 10);
const fyEndYear = Number(today.slice(0, 4)) + (today.slice(5) > "03-31" ? 1 : 0);
const societyId = await db.insert("societies", { name: "Harbour Rowing Club", fiscalYearEnd: "03-31" });
const ownerId = await db.insert("users", { societyId, role: "Owner", status: "Active", displayName: "Olive Owner", email: "olive@example.org", phone: "+15550001111" });
const directorId = await db.insert("users", { societyId, role: "Director", status: "Active", displayName: "Dana Director", email: "dana@example.org" });
const memberId = await db.insert("users", { societyId, role: "Member", status: "Active", displayName: "Max Member", email: "max@example.org" });
const connection = await db.insert("financialConnections", { societyId, provider: "demo", status: "connected" });
const operating = await db.insert("financialAccounts", { societyId, connectionId: connection, externalId: "op", name: "Operating chequing", currency: "CAD", accountType: "Bank", subtype: "cash", balanceCents: 320_000, isRestricted: false });
await db.insert("financialAccounts", { societyId, connectionId: connection, externalId: "grant", name: "Grant fund", currency: "CAD", accountType: "Bank", balanceCents: 9_000_000, isRestricted: true });
// Travel: $150 planned, $180 spent (over). Rent: half spent. Donations: a revenue line.
for (const [category, plannedCents] of [["Travel", 15_000], ["Rent", 100_000], ["Donations", 100_000]] as const) {
  await db.insert("budgets", { societyId, fiscalYear: String(fyEndYear), category, plannedCents });
}
const txn = (externalId: string, amountCents: number, extra: Record<string, unknown>) =>
  db.insert("financialTransactions", { societyId, connectionId: connection, accountId: operating, externalId, date: today, description: externalId, amountCents, ...extra });
await txn("ferry", -18_000, { category: "Travel", receiptStatus: "missing" });
await txn("hall", -50_000, { category: "Rent", receiptStatus: "attached" });
await txn("gift", 95_000, { category: "Donations" });
await txn("mystery", -2_000, {});
await txn("card-payment", -40_000, { category: "Transfer" });
await db.insert("deadlines", { societyId, title: "Annual report", dueDate: date(10), category: "Filing" });
await db.insert("deadlines", { societyId, title: "Insurance renewal", dueDate: date(25), category: "Insurance" });
await db.insert("expenseReports", { societyId, claimantName: "Pat", title: "Oars", category: "Equipment", amountCents: 42_000, currency: "CAD", incurredAtISO: iso(-9), submittedAtISO: iso(-5), status: "Submitted", requiredApprovals: 2, approvals: [], createdAtISO: iso(-9), updatedAtISO: iso(-5) });
await db.insert("expenseReports", { societyId, claimantName: "Sam", title: "Snacks", category: "Events", amountCents: 3_000, currency: "CAD", incurredAtISO: iso(-1), submittedAtISO: iso(-1), status: "Submitted", createdAtISO: iso(-1), updatedAtISO: iso(-1) });

const owner = as(ownerId, societyId);
const director = as(directorId, societyId);
const member = as(memberId, societyId);

// --- Catalogue helpers -------------------------------------------------------------
assert.equal(preferenceKindFor({ kind: "general", linkHref: "/grants/abc" }), "grant", "legacy grant rows map to the grant kind");
assert.equal(preferenceKindFor({ kind: "general", linkHref: "/app/commitments" }), "commitment");
assert.equal(preferenceKindFor({ kind: "renewal" }), "notice", "campaign kinds map to notices");
assert.equal(preferenceKindFor({ kind: "something-new" }), "general");
assert.equal(prefAllows([], "inApp", "deadline"), true, "in-app defaults on");
assert.equal(prefAllows([], "sms", "deadline"), false, "text messages default off");
assert.equal(prefAllows([{ channel: "email", kind: "all", enabled: false }, { channel: "email", kind: "budget", enabled: true }], "email", "budget"), true, "an exact switch beats the wildcard");
assert.equal(resolveNotificationRules([]).deadline_lead.value, 14, "deadline lead defaults to 14 days");
console.log("✓ catalogue: legacy kind mapping, channel defaults, rule defaults");

// --- Thresholds: who may change them -------------------------------------------------
await owner.runMutation("notifications:setRule", { societyId, rule: "low_balance", enabled: true, value: 500_000, accountId: operating });
await owner.runMutation("notifications:setRule", { societyId, rule: "deadline_lead", enabled: true, value: 21 });
await assert.rejects(director.runMutation("notifications:setRule", { societyId, rule: "budget_line", enabled: false, value: 50 }), /Permission/, "a director can't change workspace thresholds");
await assert.rejects(owner.runMutation("notifications:setRule", { societyId, rule: "nope", enabled: true, value: 1 }), /Unknown alert threshold/);
await owner.runMutation("notifications:setRule", { societyId, rule: "claim_waiting", enabled: true, value: 9999 });
const clamped: any = (await db.query("notificationRules").collect()).find((row: any) => row.rule === "claim_waiting");
assert.equal(clamped.value, 90, "threshold values are clamped to the rule's range");
await owner.runMutation("notifications:setRule", { societyId, rule: "claim_waiting", enabled: true, value: 3 });
console.log("✓ thresholds: finance edit access required, unknown rules rejected, values clamped");

// --- The scan raises each alert once --------------------------------------------------
const first = await owner.runMutation<{ created: number }>("notifications:evaluateAlerts", { societyId });
const titles = (await db.query("notifications").collect()).map((row: any) => row.title).sort();
assert.deepEqual(titles, [
  "Claim waiting over 3 days: Oars",
  "Due soon: Annual report",
  "Operating chequing is below $5,000",
  `Travel is over budget (FY ${fyEndYear})`,
], "deadline inside the 21-day lead, Travel over plan, the low balance and the 5-day-old claim (not revenue, not a half-spent line, not a 1-day-old claim, not a deadline 25 days out)");
assert.equal(first.created, 4);
assert.equal((await owner.runMutation<{ created: number }>("notifications:evaluateAlerts", { societyId })).created, 0, "a second scan raises nothing new");
await assert.rejects(director.runMutation("notifications:evaluateAlerts", { societyId }), /Permission/, "running the scan needs task edit access");
// A week later the balance is still low: it comes back; the deadline doesn't repeat.
const later = await scanSocietyAlerts({ db } as any, societyId, now + 8 * DAY);
const balanceRows = (await db.query("notifications").collect()).filter((row: any) => row.kind === "balance");
assert.equal(balanceRows.length, 2, "a low balance is raised again after a week");
assert.ok(later.created >= 1);
// Rent crosses 90% (one alert), then goes over plan (a second alert).
await txn("hall-2", -42_000, { category: "Rent", receiptStatus: "attached" });
await scanSocietyAlerts({ db } as any, societyId, now);
await txn("hall-3", -10_000, { category: "Rent", receiptStatus: "attached" });
await scanSocietyAlerts({ db } as any, societyId, now);
const rentTitles = (await db.query("notifications").collect()).map((row: any) => row.title).filter((title: string) => title.startsWith("Rent")).sort();
assert.deepEqual(rentTitles, [`Rent is over budget (FY ${fyEndYear})`, `Rent passed 90% of budget (FY ${fyEndYear})`], "crossing the threshold, then going over plan, raises one alert each");
const claimBody = (await db.query("notifications").collect()).find((row: any) => row.kind === "approval")?.body;
assert.match(String(claimBody), /0 of 2 approvals so far\./);
console.log("✓ scan: thresholds evaluated, deduped, low balance repeats weekly");

// --- Who sees what in the app ------------------------------------------------------------
const list = (runtime: PortableRuntime) => runtime.runQuery<any[]>("notifications:list", { societyId, limit: 200 });
const memberKinds = new Set((await list(member)).map((row) => row.kind));
assert.ok(!memberKinds.has("budget") && !memberKinds.has("balance") && !memberKinds.has("approval") && !memberKinds.has("deadline"), "a member never sees finance or deadline alerts");
assert.ok((await list(director)).some((row) => row.kind === "budget"), "a director (finance read) sees budget alerts");
await owner.runMutation("notifications:setMyPref", { societyId, channel: "inApp", kind: "budget", enabled: false });
assert.ok(!(await list(owner)).some((row) => row.kind === "budget"), "turning budget alerts off in-app hides them from the owner");
assert.ok((await list(director)).some((row) => row.kind === "budget"), "…but only for the owner");
const unread = await owner.runQuery<number>("notifications:unreadCount", { societyId });
assert.equal(unread, (await list(owner)).length, "the unread count follows the same switches");
console.log("✓ in-app: role-gated kinds and personal in-app switches apply to the list and the count");

// --- Personal switches are personal ---------------------------------------------------------
await member.runMutation("notifications:setMyPref", { societyId, channel: "email", kind: "general", enabled: false });
await assert.rejects(member.runMutation("notifications:setMyPref", { societyId, channel: "email", kind: "budget", enabled: true }), /don't receive/, "can't subscribe to a kind your role can't receive");
await assert.rejects(member.runMutation("notifications:setMyPref", { societyId, channel: "pigeon", kind: "general", enabled: true }), /Unknown notification channel/);
await assert.rejects(member.runMutation("notifications:setMyPref", { societyId, channel: "sms", kind: "digest:weekly", enabled: true }), /Digests are sent by email/);
await assert.rejects(director.runQuery("notifications:listPrefs", { userId: ownerId }), /Admin|role|Permission/i, "someone else's switches need an admin");
const memberPrefs: any[] = await db.query("notificationPrefs").collect();
assert.ok(memberPrefs.every((row) => row.userId !== memberId || row.kind === "general"), "a member's save lands on their own row only");
console.log("✓ switches: saved for the signed-in person only, validated against role and channel");

// --- Settings payload --------------------------------------------------------------------
const memberSettings: any = await member.runQuery("notifications:settings", { societyId });
assert.ok(!memberSettings.kinds.includes("budget") && memberSettings.kinds.includes("general"), "members are offered only kinds they can receive");
assert.equal(memberSettings.rules.length, 0, "members see no finance or deadline thresholds");
assert.equal(memberSettings.accounts.length, 0, "no account balances without finance read");
const ownerSettings: any = await owner.runQuery("notifications:settings", { societyId });
const budgetRule = ownerSettings.rules.find((rule: any) => rule.rule === "budget_line");
assert.equal(budgetRule.canEdit, true);
assert.equal(budgetRule.preview.matches, 2, "two expense lines (Travel, Rent) are past 90%; Donations is revenue");
const directorSettings: any = await director.runQuery("notifications:settings", { societyId });
assert.ok(directorSettings.rules.every((rule: any) => rule.canEdit === false), "directors can read but not edit thresholds");
console.log("✓ settings: kinds, thresholds and accounts follow the viewer's role");

// --- Digests -----------------------------------------------------------------------------
await owner.runMutation("notifications:setMyPref", { societyId, channel: "email", kind: "digest:weekly", enabled: true });
await owner.runMutation("notifications:setMyPref", { societyId, channel: "sms", kind: "deadline", enabled: true });
const daily = await buildDigestPlan({ db } as any, societyId, "daily", now);
const ownerDaily = daily.find((row) => row.userId === ownerId)!;
assert.ok(ownerDaily.email && ownerDaily.emailLines.length > 0, "the owner gets a daily digest by default");
assert.ok(ownerDaily.phone && ownerDaily.smsSummary, "the owner opted in to texts for deadlines");
assert.ok(!daily.some((row) => row.userId === memberId), "nothing a member can see is unread, so no digest");
const weekly = await buildDigestPlan({ db } as any, societyId, "weekly", now);
assert.deepEqual(weekly.map((row) => row.userId), [ownerId], "only people who opted in get the weekly summary");
const lines = weekly[0].emailLines.join("\n");
assert.match(lines, /1 deadline due in the next 21 days\./);
assert.match(lines, /2 claims awaiting approval \(oldest waiting 5 days\)\./);
assert.match(lines, /2 transactions need attention this fiscal year: 1 uncategorized, 1 missing receipt\./, "transfers never need attention");
await owner.runMutation("notifications:setMyPref", { societyId, channel: "email", kind: "digest:daily", enabled: false });
assert.ok(!(await buildDigestPlan({ db } as any, societyId, "daily", now)).some((row) => row.userId === ownerId && row.email), "the daily digest can be turned off");
console.log("✓ digests: daily honours switches and opt-in texts; weekly is opt-in with deadlines, claims and transactions needing attention");

console.log("\nNotification settings checks passed.");
