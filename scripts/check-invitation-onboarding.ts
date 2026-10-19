import assert from "node:assert/strict";
import { mock } from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";

const modules = {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./invitations.js": () => import("../convex/invitations"),
  "./authEmails.js": () => import("../convex/authEmails"),
  "./users.js": () => import("../convex/users"),
};
// Keep scheduled retries deterministic; invoke the handlers explicitly below.
mock.timers.enable({ apis: ["setTimeout"] });
const t = convexTest(schema, modules);
const issuer = betterAuthIssuer();
const fixture = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Inviting organization", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const otherId = await ctx.db.insert("societies", { name: "Existing organization", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const ownerId = await ctx.db.insert("users", { societyId, email: "owner@example.test", displayName: "Owner", role: "Owner", status: "Active", authIssuer: issuer, authSubject: "owner", createdAtISO: new Date().toISOString() });
  const existingId = await ctx.db.insert("users", { societyId: otherId, email: "existing@example.test", displayName: "Existing", role: "Owner", status: "Active", authIssuer: issuer, authSubject: "existing", createdAtISO: new Date().toISOString() });
  const placeholder = await ctx.db.insert("users", { societyId, email: "Placeholder@example.test", displayName: "Placeholder", role: "Admin", status: "Active", createdAtISO: new Date().toISOString() });
  return { societyId, otherId, ownerId, existingId, placeholder };
});
const identity = (subject: string, email = `${subject}@example.test`, emailVerified = true) => t.withIdentity({ issuer, subject, email, emailVerified });
const owner = identity("owner");
const invited = identity("new");
const create = (email: string, extra: Record<string, unknown> = {}) => owner.mutation(api.invitations.create, { societyId: fixture.societyId, email, role: "Member", ...extra });
const issued = await create("NEW@example.test");
assert.equal((await t.run(ctx => ctx.db.get(issued.id)))?.emailStatus, "queued", "Email queued even before account/membership exists");
assert.equal((await invited.query(api.invitations.pendingForAccount, {}))[0].workspaceName, "Inviting organization");
assert.deepEqual(await t.query(api.invitations.pendingForAccount, {}), []);
assert.deepEqual(await identity("new", "new@example.test", false).query(api.invitations.pendingForAccount, {}), []);
assert.equal((await identity("wrong").mutation(api.invitations.acceptForAccount, { id: issued.id })).status, "invitation-email-mismatch");
assert.equal((await identity("new", "new@example.test", false).mutation(api.invitations.acceptForAccount, { id: issued.id })).status, "invitation-email-unverified");
const joined = await invited.mutation(api.invitations.acceptForAccount, { id: issued.id });
assert.equal(joined.status, "invitation-accepted");
assert.equal(joined.societyId, fixture.societyId);
assert.equal((await t.run(ctx => ctx.db.query("societies").collect())).length, 2, "Joining creates no organization");
assert.deepEqual(await invited.query(api.invitations.pendingForAccount, {}), []);
assert.equal((await invited.mutation(api.invitations.acceptForAccount, { id: issued.id })).status, "invitation-already-accepted");
const another = await create("existing@example.test", { role: "Viewer" });
const existing = identity("existing");
assert.equal((await existing.query(api.invitations.pendingForAccount, {})).length, 1);
const joinedOther = await existing.mutation(api.invitations.acceptForAccount, { id: another.id });
assert.equal(joinedOther.status, "invitation-accepted");
assert.equal((await t.run(ctx => ctx.db.get(fixture.existingId)))?.role, "Owner", "Existing workspace keeps its role");
assert.equal((await t.run(ctx => ctx.db.get(joinedOther.userId)))?.role, "Viewer", "New workspace has its own role");
const escalation = await create("existing@example.test", { role: "Admin" });
await existing.mutation(api.invitations.accept, { token: escalation.token });
assert.equal((await t.run(ctx => ctx.db.get(joinedOther.userId)))?.role, "Viewer", "Invitation cannot silently promote an existing member");
const link = await owner.mutation(api.invitations.create, { societyId: fixture.societyId, kind: "link", role: "Viewer" });
assert.equal((await identity("link").mutation(api.invitations.acceptForAccount, { id: link.id })).status, "invalid-invitation", "A share-link ID is not a credential");
const old = await create("expired@example.test");
await t.run(ctx => ctx.db.patch(old.id, { expiresAtISO: "2020-01-01T00:00:00Z" }));
assert.deepEqual(await identity("expired").query(api.invitations.pendingForAccount, {}), []);
assert.equal((await identity("expired").mutation(api.invitations.acceptForAccount, { id: old.id })).status, "invitation-expired");
const revoked = await create("revoked@example.test");
await owner.mutation(api.invitations.revoke, { id: revoked.id });
assert.deepEqual(await identity("revoked").query(api.invitations.pendingForAccount, {}), []);
const rotation = await create("rotate@example.test");
await assert.rejects(() => owner.mutation(api.invitations.resend, { id: rotation.id }), /one minute/);
await t.run(ctx => ctx.db.patch(rotation.id, { emailRequestedAtMs: 0 }));
const reissued = await owner.mutation(api.invitations.resend, { id: rotation.id });
assert.equal(await t.query(api.invitations.getByToken, { token: rotation.token }), null);
assert.ok(await t.query(api.invitations.getByToken, { token: reissued.token }));
assert.equal(await t.query(internal.invitations.emailContext, { id: rotation.id, token: rotation.token }), null, "Rotated mail job is canceled");
assert.equal(await t.query(internal.invitations.emailContext, { id: revoked.id, token: revoked.token }), null, "Revoked mail job is canceled");
const placeholderInvitation = await create("placeholder@example.test", { targetUserId: fixture.placeholder, role: "Admin" });
const bound = await identity("placeholder").mutation(api.invitations.acceptForAccount, { id: placeholderInvitation.id });
assert.equal(bound.userId, fixture.placeholder, "Explicit invitation binds the existing placeholder without a duplicate");
assert.equal((await t.run(ctx => ctx.db.get(fixture.placeholder)))?.authSubject, "placeholder");
await assert.rejects(() => create("wrong@example.test", { targetUserId: fixture.ownerId, role: "Member" }), /unbound user/);
const listed = await owner.query(api.invitations.list, { societyId: fixture.societyId });
assert.ok(listed.every((i: any) => !i.token && !i.tokenHash));

const lostAuthority = await create("authority@example.test");
await t.run(ctx => ctx.db.patch(fixture.ownerId, { role: "Member" }));
assert.deepEqual(await identity("authority").query(api.invitations.pendingForAccount, {}), []);
assert.equal((await identity("authority").mutation(api.invitations.acceptForAccount, { id: lostAuthority.id })).status, "invitation-issuer-unavailable");
await t.run(ctx => ctx.db.patch(fixture.ownerId, { role: "Owner" }));
const ownerIdentity = await t.run(async ctx => {
  const id = await ctx.db.insert("externalIdentities", { issuer, subject: "owner", status: "Disabled", createdAtISO: new Date().toISOString() });
  await ctx.db.patch(fixture.ownerId, { externalIdentityId: id });
  return id;
});
assert.equal((await identity("authority").mutation(api.invitations.acceptForAccount, { id: lostAuthority.id })).status, "invitation-issuer-unavailable", "Global identity disable also invalidates inviter authority");
await t.run(ctx => ctx.db.patch(ownerIdentity, { status: "Active" }));

// Execute real internal mail actions with the provider boundary stubbed.
const savedEnv = { ...process.env };
const realFetch = globalThis.fetch;
try {
  process.env.SITE_URL = "https://societyer.example.test";
  process.env.SOCIETYER_EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "fixture-only";
  process.env.RESEND_FROM_EMAIL = "sender@example.test";
  let outbound: any[] = [];
  globalThis.fetch = async (_url, init) => { outbound.push(JSON.parse(String(init?.body))); return new Response('{"id":"mail-fixture"}', { status: 200 }); };
  const deliver = await create("delivery@example.test");
  await t.action(internal.invitations.deliverEmail, { id: deliver.id, token: deliver.token });
  assert.equal((await t.run(ctx => ctx.db.get(deliver.id)))?.emailStatus, "accepted");
  assert.ok(outbound.some(mail => mail.text.includes(`/invite/${deliver.token}`)));
  const context = { runMutation: async (_ref: unknown, args: any) => { if (args.buckets) return { ok: true }; if (args.subject) outbound.push(args); return "fixture"; } };
  process.env.AUTH_MODE = "convex";
  process.env.CONVEX_SITE_URL = "https://fixture.convex.site";
  process.env.BETTER_AUTH_SECRET = "fixture-only-long-secret-for-email-tests-12345";
  process.env.SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS = "example.test";
  delete process.env.SOCIETYER_AUTH_DEVELOPMENT_MAIL;
  const { createAuth } = await import("../convex/hostedAuth");
  const configured = createAuth(context as never);
  const accounts: Record<string, any[]> = { user: [], account: [], session: [], verification: [] };
  // Exercise the actual Better Auth signup routes with the production options,
  // substituting only its persistence adapter and component transport plugins.
  const auth = betterAuth({ ...configured.options, database: memoryAdapter(accounts), plugins: [], logger: { disabled: true } });
  const signup = () => auth.handler(new Request("https://fixture.convex.site/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "https://societyer.example.test" }, body: JSON.stringify({ name: "Retry account", email: "retry@example.test", password: "fixture-password-12345", callbackURL: "https://societyer.example.test/login?verified=1&redirect=%2Finvite%2Ffixture" }) }));
  const before = outbound.length;
  assert.equal((await signup()).status, 200);
  assert.equal(outbound.length, before + 1, "First signup queues verification");
  assert.equal((await signup()).status, 200);
  assert.equal(outbound.length, before + 2, "Duplicate unverified signup queues verification again");
  const mailURL = new URL(outbound.at(-1).text.match(/https?:\/\/\S+/)[0]);
  assert.ok(mailURL.searchParams.get("callbackURL")?.includes("redirect=%2Finvite%2Ffixture"), "Invite return path survives duplicate signup");
  assert.equal(accounts.user.length, 1, "Duplicate signup preserves the original account");
  assert.equal((await auth.handler(new Request(mailURL))).status, 302, "Resent token verifies the account through the real route");
  const beforeVerified = outbound.length;
  assert.equal((await signup()).status, 200);
  assert.equal(outbound.length, beforeVerified, "Already verified signup does not spam verification");

  const queue = await t.mutation(internal.authEmails.enqueue, { to: "queued@example.test", subject: "Verify", text: "private-token", html: "private-token", tag: "auth-verify-email" });
  await t.action(internal.authEmails.deliver, { id: queue });
  let row = await t.run(ctx => ctx.db.get(queue));
  assert.equal(row?.status, "accepted");
  assert.equal(row?.text, undefined, "Token body erased after acceptance");
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  const failed = await t.mutation(internal.authEmails.enqueue, { to: "failed@example.test", subject: "Verify", text: "private-token", html: "private-token", tag: "auth-verify-email" });
  await t.action(internal.authEmails.deliver, { id: failed });
  row = await t.run(ctx => ctx.db.get(failed));
  assert.equal(row?.status, "queued", "Provider failure schedules retry instead of claiming sent");
  await t.run(ctx => ctx.db.patch(failed, { status: "queued", attempts: 2 }));
  await t.action(internal.authEmails.deliver, { id: failed });
  row = await t.run(ctx => ctx.db.get(failed));
  assert.equal(row?.status, "failed");
  assert.equal(row?.text, undefined, "Token erased when retries exhausted");
  const stranded = await t.mutation(internal.authEmails.enqueue, { to: "stranded@example.test", subject: "Verify", text: "private-token", html: "private-token", tag: "auth-verify-email" });
  const claimed = await t.mutation(internal.authEmails.claim, { id: stranded });
  assert.equal(claimed?.attempts, 1);
  await t.mutation(internal.authEmails.recover, { id: stranded, attempt: 1 });
  assert.equal((await t.run(ctx => ctx.db.get(stranded)))?.status, "queued", "Terminated action is recovered");
  await t.mutation(internal.authEmails.claim, { id: stranded });
  await t.mutation(internal.authEmails.finish, { id: stranded, attempt: 1, accepted: true });
  assert.equal((await t.run(ctx => ctx.db.get(stranded)))?.status, "sending", "Stale attempt cannot overwrite a newer delivery");
  await t.run(ctx => ctx.db.patch(failed, { expiresAtMs: 0 }));
  await t.mutation(internal.authEmails.expire, { id: failed });
  assert.equal(await t.run(ctx => ctx.db.get(failed)), null);
} finally {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
mock.timers.reset();
console.log("Invitation onboarding passed: mail before account creation, verified-email inbox, no organization required, existing-user second workspace, independent roles, placeholder binding, expired/revoked/stale link denial, resend cooldown, actual duplicate-signup verification and redirect, durable delivery retries and token cleanup.");
