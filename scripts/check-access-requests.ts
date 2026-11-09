/**
 * Self-service workspace access requests (accessRequests:*): discovery only
 * through a verified domain with requests turned on, one request per person,
 * Owner/Admin decisions within their own authority, and an approval that binds
 * exactly the identity that asked without bypassing the workspace's sign-in policy.
 */
import assert from "node:assert/strict";
import { mock } from "node:test";
import { convexTest } from "convex-test";
import { exportPKCS8, generateKeyPair } from "jose";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const issuer = "https://access-requests.convex.site";
const tenant = "220c85f6-1cb1-4bb2-a63b-55d9fd163b55";
const group = "815b3b71-596d-48fe-aafd-f5bf34aafa5c";
const assertionKey = await generateKeyPair("PS256", { extractable: true });
Object.assign(process.env, {
  AUTH_MODE: "convex", VITE_AUTH_MODE: "convex", CONVEX_SITE_URL: issuer,
  SITE_URL: "https://app.access.example,https://open.access.example,https://ddc.access.example",
  BETTER_AUTH_SECRET: "access-requests-test-secret-00000000000000000000",
  SOCIETYER_ENTRA_LOGIN: "1", MICROSOFT_LOGIN_TENANT_ID: tenant, MICROSOFT_LOGIN_CLIENT_ID: "11111111-2222-4333-8444-555555555555",
  MICROSOFT_LOGIN_GROUP_IDS: group, MICROSOFT_LOGIN_PRIVATE_KEY: await exportPKCS8(assertionKey.privateKey),
  MICROSOFT_LOGIN_CERT_SHA256: "A".repeat(43),
});
for (const key of ["SOCIETYER_ENTRA_SSO_REQUIRED", "SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS", "SOCIETYER_AUTH_MANUAL_PROVISIONING"]) delete process.env[key];

// Keep the scheduled approver email out of the run; its context is checked directly.
mock.timers.enable({ apis: ["setTimeout"] });
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api"),
  "./_generated/server.js": () => import("../convex/_generated/server"),
  "./http.js": () => import("../convex/http"),
  "./society.js": () => import("../convex/society"),
  "./users.js": () => import("../convex/users"),
  "./accessRequests.js": () => import("../convex/accessRequests"),
});

const now = Date.now();
type Options = { emailVerified?: boolean; sessionId?: string | null; microsoft?: boolean };
function claims(subject: string, options: Options = {}) {
  const proof = options.microsoft ? {
    userId: subject, tenantId: tenant, objectId: "5c45d5ce-1834-4779-b001-3ae5df851335", groupIds: [group],
    authenticatedAt: now - 60_000, expiresAt: now + 3600_000,
  } : null;
  return {
    issuer, subject, tokenIdentifier: `${issuer}|${subject}`, email: `${subject}@example.test`, emailVerified: options.emailVerified ?? true,
    name: `Person ${subject}`,
    ...(options.sessionId === null ? {} : { "societyer_session.id": options.sessionId ?? `session-${subject}`, "societyer_session.createdAt": now - 60_000 }),
    ...(proof ? Object.fromEntries(Object.entries(proof).map(([key, value]) => [`societyer_entra.${key}`, value])) : {}),
  };
}
const as = (subject: string, options?: Options) => t.withIdentity(claims(subject, options));
type Client = ReturnType<typeof as>;

const fixture = await t.run(async (ctx) => {
  const iso = new Date(0).toISOString();
  const workspace = (name: string) => ctx.db.insert("societies", { name, isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const [open, ddc, unmapped, disabledDomain] = await Promise.all(["Open Org", "DDC North", "Unmapped Org", "Disabled Domain Org"].map(workspace));
  const identity = (subject: string, status = "Active") => ctx.db.insert("externalIdentities", { issuer, subject, status, createdAtISO: iso });
  const member = async (societyId: Id<"societies">, subject: string, role: string, status = "Active") => ctx.db.insert("users", {
    societyId, email: `${subject}@example.test`, displayName: `Person ${subject}`, role, status, authIssuer: issuer, authSubject: subject,
    authProvider: "convex", externalIdentityId: await identity(subject), createdAtISO: iso,
  });
  const domain = (origin: string, societyId: Id<"societies">, status: "Active" | "Disabled" = "Active") => ctx.db.insert("workspaceDomains", {
    origin, hostname: new URL(origin).host, societyId, status, primary: true, createdAtISO: iso, updatedAtISO: iso,
  });
  await domain("https://open.access.example", open);
  await domain("https://ddc.access.example", ddc);
  await domain("https://app.access.example", disabledDomain, "Disabled");
  const owner = await member(open, "owner", "Owner");
  await member(open, "admin", "Admin");
  await member(open, "viewer", "Viewer");
  await member(open, "gone", "Member", "Disabled");
  await member(open, "lk1", "Member");
  await member(ddc, "ddc-owner", "Owner");
  await member(unmapped, "unmapped-owner", "Owner");
  await member(disabledDomain, "dd-owner", "Owner");
  // lk2 is proven to be the same person as lk1, who is already a member of Open Org.
  const lk2Identity = await identity("lk2");
  const lk1Identity = (await ctx.db.query("externalIdentities").withIndex("by_issuer_subject", (q) => q.eq("issuer", issuer).eq("subject", "lk1")).unique())!._id;
  const person = await ctx.db.insert("personAccounts", { status: "Active", createdAtISO: iso, updatedAtISO: iso });
  for (const [subject, externalIdentityId] of [["lk1", lk1Identity], ["lk2", lk2Identity]] as const) {
    await ctx.db.insert("personIdentityLinks", { personAccountId: person, externalIdentityId, issuer, subject, status: "Active", linkedAtISO: iso });
  }
  // An unbound placeholder already uses dup@example.test in Open Org.
  await ctx.db.insert("users", { societyId: open, email: "dup@example.test", displayName: "Placeholder", role: "Member", status: "Active", createdAtISO: iso });
  await ctx.db.insert("workspaceSignInPolicies", { societyId: ddc, requiredMethod: "microsoft", microsoftTenantId: tenant, microsoftGroupIds: [group],
    updatedAtISO: iso, reason: "DDC requires Microsoft" });
  return { open, ddc, unmapped, disabledDomain, owner };
});

const reachable = async (client: Client, id: Id<"societies">) => {
  try { return (await client.query(api.society.getById, { id }))._id === id; } catch { return false; }
};
const availability = (client: Client, societyId: Id<"societies"> = fixture.open) => client.query(api.accessRequests.availability, { societyId });
const submit = (client: Client, note?: string, societyId: Id<"societies"> = fixture.open) =>
  client.mutation(api.accessRequests.submit, { societyId, ...(note === undefined ? {} : { note }) });
const enable = (client: Client, societyId: Id<"societies">, extra: { defaultRole?: "Viewer" | "Member"; message?: string; enabled?: boolean } = {}) =>
  client.mutation(api.accessRequests.setSettings, { societyId, enabled: extra.enabled ?? true, defaultRole: extra.defaultRole ?? "Viewer", ...(extra.message ? { message: extra.message } : {}) });
const owner = as("owner");
const admin = as("admin");
const viewer = as("viewer");

// Off by default: availability reveals nothing and nobody can ask.
assert.deepEqual(await availability(as("r1")), { enabled: false });
assert.deepEqual(await submit(as("r1")), { status: "unavailable" });
assert.deepEqual(await owner.query(api.accessRequests.getSettings, { societyId: fixture.open }),
  { enabled: false, defaultRole: "Viewer", requestOrigin: "https://open.access.example" });
assert.deepEqual(await owner.query(api.accessRequests.listForWorkspace, { societyId: fixture.open }), []);

// Settings are Owner/Admin only, and limited to Viewer or Member as the default.
await assert.rejects(enable(viewer, fixture.open), /Role Admin required/);
await assert.rejects(enable(as("ddc-owner"), fixture.open), /membership not found/i, "A foreign workspace's owner can't change it");
await assert.rejects(enable(admin, fixture.open, { message: "x".repeat(501) }), /under 500/);
await assert.rejects(admin.mutation(api.accessRequests.setSettings, { societyId: fixture.open, enabled: true, defaultRole: "Admin" as "Member" }));
await enable(admin, fixture.open, { defaultRole: "Member", message: "Tell us which committee you're on." });
assert.deepEqual(await viewer.query(api.accessRequests.availability, { societyId: fixture.open }).then((value) => value.enabled), true);

// A workspace with no Active verified domain reveals nothing even with requests on.
await enable(as("unmapped-owner"), fixture.unmapped);
await enable(as("dd-owner"), fixture.disabledDomain);
assert.deepEqual(await availability(as("r1"), fixture.unmapped), { enabled: false });
assert.deepEqual(await submit(as("r1"), undefined, fixture.unmapped), { status: "unavailable" });
assert.deepEqual(await availability(as("r1"), fixture.disabledDomain), { enabled: false });
assert.equal((await as("unmapped-owner").query(api.accessRequests.getSettings, { societyId: fixture.unmapped })).requestOrigin, undefined);
// Nor to anything but a deployment-signed session.
assert.deepEqual(await t.query(api.accessRequests.availability, { societyId: fixture.open }), { enabled: false });
assert.deepEqual(await availability(as("r1", { sessionId: null })), { enabled: false });
assert.deepEqual(await submit(as("r1", { sessionId: null })), { status: "unauthenticated" });
assert.deepEqual(await t.mutation(api.accessRequests.submit, { societyId: fixture.open }), { status: "unauthenticated" });

// Open for requests: the message and nothing about other people.
assert.deepEqual(await availability(as("r1")), { enabled: true, alreadyMember: false, message: "Tell us which committee you're on." });
assert.deepEqual(await submit(as("r1", { emailVerified: false })), { status: "email-unverified" });
await assert.rejects(submit(as("r1"), "n".repeat(501)), /under 500/);

// Submit, then a duplicate returns the same pending request.
const first = await submit(as("r1"), "  Treasurer committee  ");
assert.equal(first.status, "requested");
assert.deepEqual(await submit(as("r1"), "again"), { status: "already-requested", id: first.id, createdAtISO: first.createdAtISO });
const stored = await t.run((ctx) => ctx.db.get(first.id as Id<"workspaceAccessRequests">));
assert.equal(stored?.requesterIssuer, issuer);
assert.equal(stored?.requesterSubject, "r1");
assert.equal(stored?.note, "Treasurer committee");
assert.equal(stored?.email, "r1@example.test");
assert.deepEqual((await availability(as("r1"))).existing, { id: first.id, status: "pending", createdAtISO: first.createdAtISO });
assert.deepEqual((await as("r1").query(api.accessRequests.mine, {})).map((row: { workspaceName: string; status: string }) => [row.workspaceName, row.status]),
  [["Open Org", "pending"]]);

// Approvers are told in the app and by email; nobody else is.
const notices = await t.run((ctx) => ctx.db.query("notifications").collect());
assert.equal(notices.length, 2, "One notice each for the Active Owner and Admin");
assert.ok(notices.every((notice) => notice.title === "r1@example.test asked to join" && notice.linkHref === "/app/users"));
const emailContext = await t.query(internal.accessRequests.emailContext, { id: first.id });
assert.deepEqual([...emailContext.recipients].sort(), ["admin@example.test", "owner@example.test"]);
assert.equal(emailContext.requesterEmail, "r1@example.test");
assert.ok((await t.run((ctx) => ctx.db.query("activity").collect())).some((row) => row.action === "access-requested" && row.entityId === first.id));

// Withdraw: only the identity that asked.
const r2 = await submit(as("r2"));
assert.deepEqual(await as("r1").mutation(api.accessRequests.withdraw, { id: r2.id }), { status: "not-found" });
assert.deepEqual(await owner.mutation(api.accessRequests.withdraw, { id: r2.id }), { status: "not-found" });
assert.deepEqual(await as("r2").mutation(api.accessRequests.withdraw, { id: r2.id }), { status: "withdrawn" });
assert.deepEqual(await as("r2").mutation(api.accessRequests.withdraw, { id: r2.id }), { status: "not-pending" });
assert.deepEqual(await as("r2").query(api.accessRequests.mine, {}), []);
assert.equal((await availability(as("r2"))).existing, undefined);
assert.equal(await t.query(internal.accessRequests.emailContext, { id: r2.id }), null, "A withdrawn request sends no email");
const r2again = await submit(as("r2"));
assert.equal(r2again.status, "requested");

// Anyone with a membership row of any status, directly or through a linked identity, is refused.
assert.deepEqual(await submit(owner), { status: "already-member" });
assert.equal((await availability(owner)).alreadyMember, true);
assert.deepEqual(await submit(as("gone")), { status: "already-member" }, "A Disabled member goes through an administrator");
assert.deepEqual(await submit(as("lk2")), { status: "already-member" }, "A linked identity's membership counts");

// At most five new requests per identity per 24 hours, across workspaces.
const spammer = as("spam");
for (let index = 0; index < 5; index += 1) {
  const result = await submit(spammer);
  assert.equal(result.status, "requested");
  await spammer.mutation(api.accessRequests.withdraw, { id: result.id });
}
assert.deepEqual(await submit(spammer), { status: "rate-limited" });
assert.deepEqual(await submit(spammer, undefined, fixture.ddc), { status: "unavailable" }, "DDC hasn't turned requests on");

// Managing requests needs Owner/Admin authority in that workspace.
await assert.rejects(viewer.query(api.accessRequests.listForWorkspace, { societyId: fixture.open }), /Role Admin required/);
await assert.rejects(as("r1").query(api.accessRequests.listForWorkspace, { societyId: fixture.open }), /membership not found/i);
await assert.rejects(as("ddc-owner").query(api.accessRequests.listForWorkspace, { societyId: fixture.open }), /membership not found/i);
await assert.rejects(as("ddc-owner").mutation(api.accessRequests.approve, { id: first.id, role: "Member" }), /Access request not found/);
await assert.rejects(viewer.mutation(api.accessRequests.decline, { id: first.id }), /Access request not found/);
await assert.rejects(as("r1").mutation(api.accessRequests.approve, { id: first.id, role: "Viewer" }), /Access request not found/);
await assert.rejects(owner.mutation(api.accessRequests.approve, { id: fixture.owner as unknown as Id<"workspaceAccessRequests">, role: "Member" }));
await assert.rejects(viewer.query(api.accessRequests.getSettings, { societyId: fixture.open }), /Role Admin required/);
const listed = await admin.query(api.accessRequests.listForWorkspace, { societyId: fixture.open });
assert.deepEqual(listed.filter((row: { status: string }) => row.status === "pending").map((row: { email: string }) => row.email).sort(),
  ["r1@example.test", "r2@example.test"]);
assert.ok(!JSON.stringify(listed).includes(issuer), "Admins see the email, not the identity binding");

// An Admin grants up to Member-level roles; Owner is never granted from a request.
await assert.rejects(admin.mutation(api.accessRequests.approve, { id: first.id, role: "Admin" }), /Only an Owner/);
await assert.rejects(owner.mutation(api.accessRequests.approve, { id: first.id, role: "Owner" }), /Promote to Owner/);
await assert.rejects(owner.mutation(api.accessRequests.approve, { id: first.id, role: "Superuser" }));
assert.equal(await reachable(as("r1"), fixture.open), false);
const approved = await admin.mutation(api.accessRequests.approve, { id: first.id, role: "Member" });
assert.equal(approved.status, "approved");
const membership = await t.run((ctx) => ctx.db.get(approved.membershipId as Id<"users">));
assert.equal(membership?.authIssuer, issuer);
assert.equal(membership?.authSubject, "r1");
assert.equal(membership?.role, "Member");
assert.equal(membership?.status, "Active");
assert.equal(membership?.email, "r1@example.test");
assert.equal(membership?.displayName, "Person r1");
assert.ok(membership?.externalIdentityId, "The exact identity gets an external identity row");
assert.equal(await reachable(as("r1"), fixture.open), true, "The requester can now open the workspace");
assert.equal(await reachable(as("r2"), fixture.open), false, "Nobody else gains anything");
assert.deepEqual(await admin.mutation(api.accessRequests.approve, { id: first.id, role: "Member" }), { status: "not-pending" });
assert.deepEqual(await admin.mutation(api.accessRequests.decline, { id: first.id }), { status: "not-pending" });
const afterApproval = await availability(as("r1"));
assert.equal(afterApproval.alreadyMember, true);
assert.equal(afterApproval.existing?.status, "approved");
assert.deepEqual(await as("r1").query(api.accessRequests.mine, {}), [], "Approved requests leave the list; the workspace appears instead");

// An Owner can grant Admin.
assert.equal((await owner.mutation(api.accessRequests.approve, { id: r2again.id, role: "Admin" })).status, "approved");
assert.equal(await reachable(as("r2"), fixture.open), true);

// Decline.
const r3 = await submit(as("r3"));
assert.deepEqual(await owner.mutation(api.accessRequests.decline, { id: r3.id }), { status: "declined" });
assert.deepEqual(await owner.mutation(api.accessRequests.approve, { id: r3.id, role: "Member" }), { status: "not-pending" });
assert.equal(await reachable(as("r3"), fixture.open), false);
assert.deepEqual((await as("r3").query(api.accessRequests.mine, {})).map((row: { status: string }) => row.status), ["declined"]);
assert.equal((await availability(as("r3"))).existing?.status, "declined");

// Approval re-checks the requester at decision time.
const r4 = await submit(as("r4"));
await t.run(async (ctx) => ctx.db.insert("users", { societyId: fixture.open, email: "r4-other@example.test", displayName: "r4", role: "Viewer", status: "Disabled",
  authIssuer: issuer, authSubject: "r4", createdAtISO: new Date().toISOString() }));
assert.deepEqual(await owner.mutation(api.accessRequests.approve, { id: r4.id, role: "Member" }), { status: "already-member" });
const r5 = await submit(as("r5"));
await t.run(async (ctx) => ctx.db.insert("externalIdentities", { issuer, subject: "r5", status: "Disabled", createdAtISO: new Date().toISOString() }));
assert.deepEqual(await owner.mutation(api.accessRequests.approve, { id: r5.id, role: "Member" }), { status: "identity-disabled" });
assert.deepEqual(await submit(as("r5")), { status: "identity-disabled" });
const dup = await submit(as("dup"));
assert.deepEqual(await owner.mutation(api.accessRequests.approve, { id: dup.id, role: "Member" }), { status: "email-in-use" });
assert.equal((await t.run((ctx) => ctx.db.query("users").withIndex("by_auth_identity", (q) => q.eq("authIssuer", issuer).eq("authSubject", "r5")).collect())).length, 0);

// Turning requests off hides everything again; pending requests stay decidable.
await enable(owner, fixture.open, { enabled: false });
assert.deepEqual(await availability(as("r3")), { enabled: false });
assert.deepEqual(await submit(as("r6")), { status: "unavailable" });

// The workspace's sign-in policy still applies after approval.
const ddcOwner = as("ddc-owner", { microsoft: true });
await enable(ddcOwner, fixture.ddc, { defaultRole: "Viewer" });
const pw = await submit(as("pw"), undefined, fixture.ddc);
assert.equal(pw.status, "requested");
assert.equal((await ddcOwner.mutation(api.accessRequests.approve, { id: pw.id, role: "Viewer" })).status, "approved");
assert.equal(await reachable(as("pw"), fixture.ddc), false, "A password session stays locked out of a Microsoft workspace");
const locked = await as("pw").query(api.http.currentPrincipalMemberships, {});
assert.equal(locked.status, "sign-in-required");
assert.deepEqual(locked.lockedWorkspaces.map((workspace: { name: string; reason: string }) => [workspace.name, workspace.reason]), [["DDC North", "microsoft"]]);
assert.equal(await reachable(as("pw", { microsoft: true }), fixture.ddc), true, "A Microsoft session for the same identity opens it");
// A password session for the DDC owner can't decide requests either.
await assert.rejects(as("ddc-owner").query(api.accessRequests.listForWorkspace, { societyId: fixture.ddc }), /Microsoft/);

console.log("Access requests: discovery, submit/withdraw, limits, decisions and sign-in policy checks passed.");
