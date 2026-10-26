import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const issuer = betterAuthIssuer();
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./notifications.js": () => import("../convex/notifications"),
} as any);
const ids = await test.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Synthetic notifications", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignSocietyId = await ctx.db.insert("societies", { name: "Foreign notifications", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users: Record<string, any> = {};
  for (const [subject, role, tenant] of [["alice", "Owner", societyId], ["bob", "Owner", societyId], ["member", "Member", societyId], ["foreign", "Owner", foreignSocietyId]] as const) {
    users[subject] = await ctx.db.insert("users", { societyId: tenant, role, status: "Active", displayName: subject, email: `${subject}@example.invalid`, authSubject: subject, authIssuer: issuer, authProvider: "better-auth", createdAtISO: "2026-01-01" });
  }
  const notice = (title: string, userId?: any, extra: Record<string, any> = {}) => ctx.db.insert("notifications", { societyId, title, userId, kind: "general", severity: "info", createdAtISO: "2026-01-01", ...extra });
  const alicePrivate = await notice("Alice private", users.alice);
  const bobPrivate = await notice("Bob private", users.bob);
  const bobDismissed = await notice("Bob dismissed", users.bob, { dismissedAt: "2026-01-01" });
  const shared = await notice("Shared notice");
  return { societyId, foreignSocietyId, users, alicePrivate, bobPrivate, bobDismissed, shared };
});
const alice = test.withIdentity({ subject: "alice", issuer });
const bob = test.withIdentity({ subject: "bob", issuer });
const member = test.withIdentity({ subject: "member", issuer });
const foreign = test.withIdentity({ subject: "foreign", issuer });
const query = { societyId: ids.societyId, includeDismissed: true };
assert.deepEqual((await alice.query(api.notifications.list, query)).map((row: any) => row.title).sort(), ["Alice private", "Shared notice"]);
assert.deepEqual((await member.query(api.notifications.list, query)).map((row: any) => row.title), ["Shared notice"]);
assert.equal(await alice.query(api.notifications.unreadCount, { societyId: ids.societyId }), 2);
for (const endpoint of [api.notifications.list, api.notifications.unreadCount]) {
  await assert.rejects(() => alice.query(endpoint, { societyId: ids.societyId, userId: ids.users.bob }), /recipient does not match/);
  await assert.rejects(() => foreign.query(endpoint, { societyId: ids.societyId }), /membership/i);
  await assert.rejects(() => test.query(endpoint, { societyId: ids.societyId }), /membership|Authentication/i);
}
for (const [endpoint, extra] of [
  [api.notifications.markRead, {}], [api.notifications.dismiss, {}], [api.notifications.snooze, { untilISO: "2099-01-01" }], [api.notifications.remove, {}],
] as const) {
  await assert.rejects(() => alice.mutation(endpoint, { id: ids.bobPrivate, ...extra }), /not found/);
}
for (const endpoint of [api.notifications.markAllRead, api.notifications.dismissAll, api.notifications.removeAllDismissed]) {
  await assert.rejects(() => alice.mutation(endpoint, { societyId: ids.societyId, userId: ids.users.bob }), /recipient does not match/);
  await alice.mutation(endpoint, { societyId: ids.societyId });
}
await test.run(async ctx => {
  const row = await ctx.db.get(ids.bobPrivate);
  assert.ok(row);
  assert.equal(row.readAt, undefined);
  assert.equal(row.dismissedAt, undefined);
  assert.equal(row.snoozedUntilISO, undefined);
  assert.ok(await ctx.db.get(ids.bobDismissed), "another user's dismissed notice survives bulk permanent deletion");
});
await bob.mutation(api.notifications.markRead, { id: ids.bobPrivate });
assert.ok((await bob.query(api.notifications.list, query)).find((row: any) => row._id === ids.bobPrivate)?.readAt);
await bob.mutation(api.notifications.dismiss, { id: ids.bobPrivate });
assert.equal(await bob.query(api.notifications.unreadCount, { societyId: ids.societyId }), 1, "Alice's bulk operations did not clear Bob's shared notice");
await bob.mutation(api.notifications.remove, { id: ids.bobPrivate });
assert.equal(await test.run(ctx => ctx.db.get(ids.bobPrivate)), null);
console.log("Notification recipient isolation passed: omitted/forged user IDs, role-visible private notices, per-record mutations, all bulk mutations, cross-workspace and anonymous denial, and own-recipient actions.");
