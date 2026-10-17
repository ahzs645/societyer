/**
 * End-to-end multi-user pipeline through the hosted Convex functions, once per
 * human session broker (Clerk, gateway Better Auth, and Convex-hosted sign-in):
 *
 *   sign up -> create a workspace as Owner -> sign in again -> invite an
 *   existing account and a brand-new account -> accept -> role-gated access.
 *
 * convex-test stands in for JWT verification (`withIdentity`), so this proves
 * the Convex side of the flow. Live keys and the browser redirects still need
 * a staging sign-in (see docs/clerk-setup.md); scripts/check-convex-hosted-auth-live.ts
 * covers the Convex-hosted broker against a running deployment.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";

const modules = {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./society.js": () => import("../convex/society"),
  "./users.js": () => import("../convex/users"),
  "./invitations.js": () => import("../convex/invitations"),
  "./permissions.js": () => import("../convex/permissions"),
  "./http.js": () => import("../convex/http"),
  "./authorization.js": () => import("../convex/authorization"),
} as any;

const CLERK_ISSUER = "https://pipeline.clerk.accounts.dev";

const CONVEX_SITE = "https://pipeline-123.convex.site";

async function runPipeline(mode: "clerk" | "better-auth" | "convex") {
  process.env.AUTH_MODE = mode;
  process.env.VITE_AUTH_MODE = mode;
  process.env.CLERK_JWT_ISSUER_DOMAIN = CLERK_ISSUER;
  process.env.CONVEX_SITE_URL = CONVEX_SITE;
  const issuer = mode === "clerk" ? CLERK_ISSUER : mode === "convex" ? CONVEX_SITE : betterAuthIssuer();
  const t = convexTest(schema, modules);
  const person = (subject: string, email: string, name: string, emailVerified = true) =>
    t.withIdentity({ subject, issuer, email, name, emailVerified });
  const label = (step: string) => `[${mode}] ${step}`;
  const userRow = (id: any) => t.run((ctx) => ctx.db.get(id)) as Promise<any>;

  // 1. A fresh account has no workspace yet, and may create one.
  const alice = person(`${mode}-alice`, "alice@example.org", "Alice Owner");
  assert.deepEqual((await alice.query(api.http.currentPrincipalMemberships, {})).memberships, [], label("new account has no memberships"));
  assert.equal((await alice.query(api.http.workspaceCreationAccess, {})).allowed, true, label("new account may create a workspace"));
  await assert.rejects(() => t.mutation(api.society.createWorkspace, { name: "Anonymous Society" }), /Authentication required|Sign in/, label("anonymous creation denied"));

  // 2. Creating the workspace makes the creator its bound, active Owner.
  const { societyId } = await alice.mutation(api.society.createWorkspace, { name: "Riverside Society", seedDocumentPackets: false });
  const aliceMemberships = (await alice.query(api.http.currentPrincipalMemberships, {})).memberships;
  assert.equal(aliceMemberships.length, 1, label("creator has one membership"));
  const aliceUserId = aliceMemberships[0].userId;
  const aliceRow = await userRow(aliceUserId);
  assert.equal(aliceRow.role, "Owner", label("creator is Owner"));
  assert.equal(aliceRow.status, "Active");
  assert.equal(aliceRow.authIssuer, issuer, label("Owner bound to the broker issuer"));
  assert.equal(aliceRow.authSubject, `${mode}-alice`);
  assert.equal(aliceRow.email, "alice@example.org", label("Owner email comes from the verified identity"));
  assert.ok(aliceRow.externalIdentityId, label("person identity recorded"));

  // 3. Signing in again resolves the same membership; no duplicate rows.
  const aliceAgain = person(`${mode}-alice`, "alice@example.org", "Alice Owner");
  assert.deepEqual(await aliceAgain.mutation(api.users.ensureCurrentMembership, { societyId }),
    { status: "bound", societyId, userId: aliceUserId }, label("returning Owner is bound"));
  assert.deepEqual((await aliceAgain.query(api.society.list, {})).map((s: any) => s._id), [societyId]);
  assert.equal((await aliceAgain.query(api.permissions.myPermissions, { societyId, userId: aliceUserId })).role, "Owner");
  assert.equal((await t.run((ctx) => ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect())).length, 1);

  // 4. Bob already has an account and his own workspace; Carol has never signed in.
  const bob = person(`${mode}-bob`, "bob@example.org", "Bob Existing");
  const { societyId: bobSocietyId } = await bob.mutation(api.society.createWorkspace, { name: "Bob's Club", seedDocumentPackets: false });
  await assert.rejects(() => bob.query(api.society.getById, { id: societyId }), /not found/, label("no access before an invite"));
  await assert.rejects(() => bob.query(api.invitations.list, { societyId }), /not found/, label("outsider cannot list invites"));
  await assert.rejects(() => bob.mutation(api.invitations.create, { societyId, email: "bob@example.org", role: "Owner" }), /not found/, label("outsider cannot self-invite"));

  const bobInvite = await alice.mutation(api.invitations.create, { societyId, email: "Bob@Example.org", role: "Director" });
  const carolInvite = await alice.mutation(api.invitations.create, { societyId, email: "carol@example.org", role: "Viewer" });
  const daveInvite = await alice.mutation(api.invitations.create, { societyId, email: "dave@example.org", role: "Admin" });
  assert.match(bobInvite.token, /^inv_[0-9a-f]{64}$/);
  const listed = await alice.query(api.invitations.list, { societyId });
  assert.equal(listed.length, 3);
  assert.ok(listed.every((row: any) => !("token" in row) && !("tokenHash" in row)), label("listed invites never expose tokens"));
  assert.deepEqual(await t.query(api.invitations.getByToken, { token: carolInvite.token }),
    { societyId, role: "Viewer", expiresAtISO: carolInvite.expiresAtISO }, label("anonymous invite preview"));

  // 5. Existing account accepts: gains a second membership; own workspace untouched.
  assert.equal((await bob.mutation(api.invitations.accept, { token: bobInvite.token })).status, "invitation-accepted", label("existing account accepts"));
  const bobMemberships = (await bob.query(api.http.currentPrincipalMemberships, {})).memberships;
  assert.equal(bobMemberships.length, 2, label("existing account now in two workspaces"));
  const bobHere = bobMemberships.find((m: any) => m.society._id === societyId);
  const bobOwn = bobMemberships.find((m: any) => m.society._id === bobSocietyId);
  assert.equal(bobHere.user.role, "Director", label("invited role applied"));
  assert.equal(bobOwn.user.role, "Owner", label("own workspace role unchanged"));
  assert.equal((await bob.mutation(api.invitations.accept, { token: bobInvite.token })).status, "invitation-already-accepted", label("token is single-use"));

  // 6. Brand-new account: first sign-in carries the token (ensureCurrentMembership path).
  const carol = person(`${mode}-carol`, "carol@example.org", "Carol New");
  assert.deepEqual(await carol.query(api.http.currentPrincipalMemberships, {}).then((r: any) => r.memberships), []);
  assert.deepEqual(await carol.mutation(api.users.ensureCurrentMembership, { societyId }), { status: "needs-invitation" }, label("no token, no access"));
  const mallory = person(`${mode}-mallory`, "mallory@example.org", "Mallory");
  assert.deepEqual(await mallory.mutation(api.invitations.accept, { token: carolInvite.token }), { status: "invitation-email-mismatch" }, label("leaked token, other email"));
  const carolUnverified = person(`${mode}-carol`, "carol@example.org", "Carol New", false);
  assert.deepEqual(await carolUnverified.mutation(api.invitations.accept, { token: carolInvite.token }), { status: "invitation-email-unverified" }, label("unverified email blocked"));
  const carolJoined = await carol.mutation(api.users.ensureCurrentMembership, { societyId, invitationToken: carolInvite.token });
  assert.equal(carolJoined.status, "invitation-accepted", label("new account accepts on first sign-in"));
  assert.equal((await userRow(carolJoined.userId)).role, "Viewer");
  assert.deepEqual(await carol.mutation(api.users.ensureCurrentMembership, { societyId }),
    { status: "bound", societyId, userId: carolJoined.userId }, label("new account signs in again without a token"));

  // 7. Revoked and expired invitations.
  const revoked = await alice.mutation(api.invitations.create, { societyId, email: "erin@example.org", role: "Member" });
  await alice.mutation(api.invitations.revoke, { id: revoked.id });
  const erin = person(`${mode}-erin`, "erin@example.org", "Erin");
  assert.equal((await erin.mutation(api.invitations.accept, { token: revoked.token })).status, "invitation-revoked");
  const expired = await alice.mutation(api.invitations.create, { societyId, email: "erin@example.org", role: "Member" });
  await t.run((ctx) => ctx.db.patch(expired.id, { expiresAtISO: new Date(Date.now() - 1000).toISOString() }));
  assert.equal((await erin.mutation(api.invitations.accept, { token: expired.token })).status, "invitation-expired");

  // 8. Access levels.
  const dave = person(`${mode}-dave`, "dave@example.org", "Dave Admin");
  const daveJoined = await dave.mutation(api.invitations.accept, { token: daveInvite.token });
  assert.equal((await userRow(daveJoined.userId)).role, "Admin");
  // Viewer: read-only, cannot manage people.
  await assert.rejects(() => carol.mutation(api.invitations.create, { societyId, email: "x@example.org", role: "Viewer" }), /Role Admin required|Permission users:write required/, label("Viewer cannot invite"));
  await assert.rejects(() => carol.mutation(api.users.setRole, { id: carolJoined.userId, role: "Owner" }), /Role Admin required|Permission users:write required/, label("Viewer cannot self-promote"));
  assert.equal((await carol.query(api.permissions.myPermissions, { societyId, userId: carolJoined.userId })).role, "Viewer");
  // Director: content writer, not a people manager.
  await assert.rejects(() => bob.query(api.invitations.list, { societyId }), /Role Admin required|Permission users:write required/, label("Director cannot list invites"));
  await assert.rejects(() => bob.mutation(api.society.updateModules, { societyId, disabledModules: [] }), /Role Admin required|Permission settings:write required/);
  // Admin: manages Members/Directors/Viewers only.
  const frank = await dave.mutation(api.invitations.create, { societyId, email: "frank@example.org", role: "Member" });
  assert.ok(frank.token, label("Admin can invite a Member"));
  await assert.rejects(() => dave.mutation(api.invitations.create, { societyId, email: "x@example.org", role: "Admin" }), /Only an Owner/, label("Admin cannot invite Admin"));
  await assert.rejects(() => dave.mutation(api.users.setRole, { id: carolJoined.userId, role: "Owner" }), /Only an Owner/);
  await dave.mutation(api.users.setRole, { id: carolJoined.userId, role: "Member" });
  assert.equal((await userRow(carolJoined.userId)).role, "Member", label("Admin can promote Viewer to Member"));
  // An Admin's pending Member invite dies with the Admin's authority.
  await alice.mutation(api.users.setRole, { id: daveJoined.userId, role: "Director" });
  const frankPerson = person(`${mode}-frank`, "frank@example.org", "Frank");
  assert.equal((await frankPerson.mutation(api.invitations.accept, { token: frank.token })).status, "invitation-issuer-unavailable", label("demoted inviter's invite is void"));
  // Owner safeguards.
  await assert.rejects(() => alice.mutation(api.users.setRole, { id: aliceUserId, role: "Admin" }), /last Active Owner/, label("last Owner kept"));
  await alice.mutation(api.users.setRole, { id: bobHere.userId, role: "Owner" });
  await alice.mutation(api.users.setRole, { id: aliceUserId, role: "Admin" });
  assert.equal((await userRow(aliceUserId)).role, "Admin", label("Owner can hand over ownership"));

  // 9. Disabling a membership blocks that workspace only.
  const carolRow = await userRow(carolJoined.userId);
  await bob.mutation(api.users.upsert, { id: carolJoined.userId, societyId, email: carolRow.email, displayName: carolRow.displayName, role: carolRow.role, status: "Disabled" });
  assert.equal((await carol.mutation(api.users.ensureCurrentMembership, { societyId })).status, "membership-disabled", label("disabled member blocked"));
  await assert.rejects(() => carol.query(api.society.getById, { id: societyId }), /disabled|not found/);

  // 10. Same subject from a different issuer is a different person.
  const impostor = t.withIdentity({ subject: `${mode}-alice`, issuer: "https://impostor.example", email: "alice@example.org", emailVerified: true });
  await assert.rejects(() => impostor.query(api.society.getById, { id: societyId }), /not found|Authentication required|Access denied/, label("foreign issuer rejected"));

  console.log(`  ${mode}: sign-up, Owner creation, re-login, existing/new invitees, revocation/expiry, role gates, disable, issuer isolation`);
}

process.env.SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT = "1";
await runPipeline("clerk");
await runPipeline("better-auth");
await runPipeline("convex");
console.log("Multi-user pipeline checks passed.");
