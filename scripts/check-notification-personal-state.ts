import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { MemoryDb, PortableRuntime, makeCapabilities } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";

const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./notifications.js": () => import("../convex/notifications"),
} as any);
const old = "2020-01-01T00:00:00.000Z";
const later = "2099-01-01T00:00:00.000Z";
const ids = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Personal inbox test", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users: Record<string, any> = {};
  for (const [subject, role] of [["alice", "Owner"], ["bob", "Member"], ["reader", "Viewer"]]) {
    users[subject] = await ctx.db.insert("users", { societyId, role, status: "Active", displayName: subject, email: `${subject}@example.invalid`, authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: old });
    await ctx.db.insert("notificationPrefs", { userId: users[subject], channel: "email", kind: "digest:weekly", enabled: true });
  }
  const notice = (title: string, extra: Record<string, any> = {}) => ctx.db.insert("notifications", { societyId, title, kind: "general", severity: "info", createdAtISO: old, ...extra });
  return { societyId, users, read: await notice("Read independently"), snooze: await notice("Snooze independently"), dismiss: await notice("Dismiss independently"), remove: await notice("Remove independently"), legacySnooze: await notice("Legacy snooze", { snoozedUntilISO: later }), legacyDismiss: await notice("Legacy dismissal with receipt", { dismissedAt: old }), legacyPurge: await notice("Legacy dismissed without receipt", { dismissedAt: old }), privateBob: await notice("Private for Bob", { userId: users.bob }) };
});
const alice = test.withIdentity({ subject: "alice", issuer });
const bob = test.withIdentity({ subject: "bob", issuer });
const reader = test.withIdentity({ subject: "reader", issuer });
const all = (actor: typeof alice) => actor.query(api.notifications.list, { societyId: ids.societyId, includeDismissed: true });
const inbox = (actor: typeof alice) => actor.query(api.notifications.list, { societyId: ids.societyId });
const state = async (actor: typeof alice, id: string) => (await all(actor)).find((row: any) => row._id === id);

await alice.mutation(api.notifications.markRead, { id: ids.read });
assert.ok((await state(alice, ids.read))?.readAt);
assert.equal((await state(bob, ids.read))?.readAt, undefined);
assert.equal((await test.run(ctx => ctx.db.get(ids.read)))?.readAt, undefined, "broadcast content remains unchanged");
await reader.mutation(api.notifications.markRead, { id: ids.read });
await bob.mutation(api.notifications.markRead, { id: ids.privateBob });
assert.ok((await state(reader, ids.read))?.readAt, "Viewer may manage their own inbox without tasks:write");
assert.ok((await state(bob, ids.privateBob))?.readAt, "Member may manage their own targeted notice");
await assert.rejects(() => bob.mutation(api.notifications.markRead, { id: ids.legacySnooze, userId: ids.users.alice } as any), /Unexpected field|Extra field|Object contains extra field|ArgumentValidationError|extra field/i);

await alice.mutation(api.notifications.snooze, { id: ids.snooze, untilISO: later });
assert.ok(!(await inbox(alice)).some((row: any) => row._id === ids.snooze));
assert.ok((await inbox(bob)).some((row: any) => row._id === ids.snooze));
await alice.mutation(api.notifications.snooze, { id: ids.snooze, untilISO: null });
assert.ok((await inbox(alice)).some((row: any) => row._id === ids.snooze));
await alice.mutation(api.notifications.snooze, { id: ids.legacySnooze, untilISO: null });
assert.ok((await inbox(alice)).some((row: any) => row._id === ids.legacySnooze), "cleared personal snooze overrides legacy global fallback");
assert.ok(!(await inbox(bob)).some((row: any) => row._id === ids.legacySnooze));
assert.equal((await test.run(ctx => ctx.db.get(ids.legacySnooze)))?.snoozedUntilISO, later);

await alice.mutation(api.notifications.dismiss, { id: ids.dismiss });
assert.ok((await state(alice, ids.dismiss))?.dismissedAt);
assert.equal((await state(bob, ids.dismiss))?.dismissedAt, undefined);
await alice.mutation(api.notifications.remove, { id: ids.remove });
assert.equal(await state(alice, ids.remove), undefined);
assert.ok(await state(bob, ids.remove));
assert.ok(await test.run(ctx => ctx.db.get(ids.remove)), "removing from Alice's inbox cannot erase the broadcast");

const daily = await test.query(internal.notifications.digestPlan, { societyId: ids.societyId, cadence: "daily" });
const aliceDaily = daily.recipients.find((row: any) => row.userId === ids.users.alice);
const bobDaily = daily.recipients.find((row: any) => row.userId === ids.users.bob);
assert.ok(aliceDaily.emailLines.some((line: string) => line.includes("Legacy snooze")));
for (const title of ["Read independently", "Dismiss independently", "Remove independently", "Private for Bob"]) assert.ok(!aliceDaily.emailLines.some((line: string) => line.includes(title)));
for (const title of ["Read independently", "Dismiss independently", "Remove independently"]) assert.ok(bobDaily.emailLines.some((line: string) => line.includes(title)));
const weekly = await test.query(internal.notifications.digestPlan, { societyId: ids.societyId, cadence: "weekly" });
for (const userId of [ids.users.alice, ids.users.bob]) {
  const dailyRecipient = daily.recipients.find((row: any) => row.userId === userId);
  const weeklyRecipient = weekly.recipients.find((row: any) => row.userId === userId);
  assert.ok(weeklyRecipient.emailLines.includes(`${dailyRecipient.emailCount} unread notifications.`), "weekly summary uses the same personal unread state as daily");
}

// Initialize a receipt on historical flags; purge cannot erase the source row.
await alice.mutation(api.notifications.markRead, { id: ids.legacyDismiss });
await test.run(async ctx => {
  const receipt = await ctx.db.query("notificationReceipts").withIndex("by_user_notification", q => q.eq("userId", ids.users.alice).eq("notificationId", ids.dismiss)).unique();
  assert.ok(receipt);
  await ctx.db.patch(receipt._id, { dismissedAt: old });
});
await test.mutation(internal.notifications.purgeDismissed, {});
await new Promise(resolve => setTimeout(resolve, 30));
await test.finishInProgressScheduledFunctions();
assert.equal(await test.run(ctx => ctx.db.get(ids.legacyPurge)), null, "untouched historical rows keep their prior retention policy");
assert.ok(await test.run(ctx => ctx.db.get(ids.legacyDismiss)), "legacy broadcast with a receipt is preserved");
assert.equal(await state(alice, ids.dismiss), undefined, "Alice's expired dismissal is removed from her own Cleared view");
assert.ok(await state(bob, ids.dismiss), "Bob's broadcast is still present and unread after Alice's retention expiry");
assert.equal((await state(bob, ids.dismiss))?.readAt, undefined);
assert.equal(await state(alice, ids.legacyDismiss), undefined);
assert.equal((await state(bob, ids.legacyDismiss))?.dismissedAt, old, "historical fallback is preserved for users who never acted");

await alice.mutation(api.notifications.markAllRead, { societyId: ids.societyId });
assert.equal(await alice.query(api.notifications.unreadCount, { societyId: ids.societyId }), 0);
assert.ok((await bob.query(api.notifications.unreadCount, { societyId: ids.societyId })) > 0);
await alice.mutation(api.notifications.dismissAll, { societyId: ids.societyId });
await alice.mutation(api.notifications.removeAllDismissed, { societyId: ids.societyId });
assert.deepEqual(await all(alice), []);
assert.ok((await inbox(bob)).length > 0);

// Hundreds of notices for another recipient no longer consume this user's
// server-side inbox window before the recipient filter runs.
await test.run(async ctx => {
  for (let i = 0; i < 250; i += 1) await ctx.db.insert("notifications", { societyId: ids.societyId, userId: ids.users.alice, title: `Private backlog ${i}`, kind: "general", severity: "info", createdAtISO: new Date().toISOString() });
});
assert.ok((await inbox(bob)).some((row: any) => row._id === ids.read));
assert.ok((await inbox(bob)).every((row: any) => !row.title.startsWith("Private backlog")));
const receipts = await test.run(ctx => ctx.db.query("notificationReceipts").collect());
assert.equal(new Set(receipts.map(row => `${row.userId}:${row.notificationId}`)).size, receipts.length, "personal state updates do not duplicate receipts");
assert.ok(receipts.some(row => row.removedAt), "compact tombstones prevent previously removed broadcasts from reappearing");

// More than one retention page verifies that changing the indexed dismissal
// field does not skip the rest of the range when the continuation runs.
const retention = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Retention pages", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const userId = await ctx.db.insert("users", { societyId, role: "Owner", status: "Active", displayName: "Retention owner", email: "retention@example.invalid", createdAtISO: old });
  for (let i = 0; i < 205; i += 1) {
    const notificationId = await ctx.db.insert("notifications", { societyId, title: `Retained broadcast ${i}`, kind: "general", severity: "info", createdAtISO: old });
    await ctx.db.insert("notificationReceipts", { societyId, userId, notificationId, dismissedAt: old });
  }
  const missingId = await ctx.db.insert("notifications", { societyId, title: "Deleted source", kind: "general", severity: "info", createdAtISO: old });
  const orphanReceiptId = await ctx.db.insert("notificationReceipts", { societyId, userId, notificationId: missingId, dismissedAt: old });
  await ctx.db.delete(missingId);
  return { societyId, orphanReceiptId };
});
const firstReceiptPage = await test.mutation(internal.notifications.purgeDismissed, { phase: "receipts" });
assert.equal(firstReceiptPage.isDone, false);
assert.ok(firstReceiptPage.purged <= 200, "one retention transaction processes at most one 200-row page");
await new Promise(resolve => setTimeout(resolve, 30));
await test.finishInProgressScheduledFunctions();
await test.run(async ctx => {
  const rows = await ctx.db.query("notificationReceipts").withIndex("by_society", q => q.eq("societyId", retention.societyId)).collect();
  assert.equal(rows.length, 205);
  assert.ok(rows.every(row => row.removedAt && !row.dismissedAt));
  assert.equal(await ctx.db.get(retention.orphanReceiptId), null, "an expired receipt whose source is gone may be removed");
  assert.equal((await ctx.db.query("notifications").withIndex("by_society", q => q.eq("societyId", retention.societyId)).collect()).length, 205, "retention never deletes another person's broadcast");
});

// A legacy local file can have no users row. Its single file owner still
// manages notices without attempting to store a synthetic hosted user ID.
const localDb = new MemoryDb({ seed: {
  societies: [{ _id: "legacy-workspace", name: "Local legacy workspace" }],
  notifications: [{ _id: "local-notice", societyId: "legacy-workspace", title: "Local notice", kind: "general", severity: "info", createdAtISO: old }],
} });
const localOwner = new PortableRuntime({ db: localDb, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user", runtime: "browser-local", assurance: "trusted-workspace", subject: "local:file-owner", userId: "local-file-owner", societyId: "legacy-workspace" }) }).registerAll(PORTABLE_FUNCTIONS);
assert.equal((await localOwner.runQuery<any[]>("notifications:list", { societyId: "legacy-workspace" })).length, 1);
await localOwner.runMutation("notifications:markRead", { id: "local-notice" });
assert.ok((await localDb.get("local-notice"))?.readAt);
await localOwner.runMutation("notifications:remove", { id: "local-notice" });
assert.equal(await localDb.get("local-notice"), null);
assert.deepEqual(await localDb.query("notificationReceipts").collect(), []);

console.log("Personal notification state passed: Member/Viewer inbox actions, independent read/snooze/dismiss/remove/bulk operations, daily/weekly digests, legacy flags, multi-page bounded retention, tombstones, recipient-indexed inbox windows, and local files without user rows.");
