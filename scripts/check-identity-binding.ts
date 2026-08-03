import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  acceptPortable,
  createPortable,
  revokePortable,
} from "../shared/functions/invitations";
import {
  bootstrapUserIdentityPortable,
  ensureCurrentMembershipPortable,
  type MembershipResolution,
} from "../shared/functions/users";
import { seedNewSocietyOwnerPortable } from "../shared/functions/society";
import {
  MemoryDb,
  PortableRuntime,
  definePortableMutation,
  makeCapabilities,
  type PortableDoc,
  type PortablePrincipal,
} from "../shared/portable/index";
import { tables } from "../src/lib/staticConvexFixtures";

type IdentityRow = PortableDoc & {
  societyId?: string;
  email?: string;
  displayName?: string;
  authProvider?: string;
  authSubject?: string;
  status?: string;
};

type ReconciliationReport = {
  source: string;
  totals: { users: number; bound: number; unbound: number };
  duplicateSubjects: Array<{ subject: string; userIds: string[] }>;
  rowsWithoutSubject: Array<{ userId: string; societyId?: string; email?: string }>;
  ambiguities: Array<{ kind: string; key: string; userIds: string[] }>;
  disabledBindings: Array<{ userId: string; subject: string }>;
};

function reconcile(rows: IdentityRow[], source: string): ReconciliationReport {
  const subjectGroups = new Map<string, IdentityRow[]>();
  const emailGroups = new Map<string, IdentityRow[]>();
  for (const row of rows) {
    if (row.authSubject) {
      const group = subjectGroups.get(row.authSubject) ?? [];
      group.push(row);
      subjectGroups.set(row.authSubject, group);
    }
    if (row.societyId && row.email) {
      const key = `${row.societyId}:${row.email.trim().toLowerCase()}`;
      const group = emailGroups.get(key) ?? [];
      group.push(row);
      emailGroups.set(key, group);
    }
  }

  const duplicateSubjects = [...subjectGroups]
    .filter(([, group]) => group.length > 1)
    .map(([subject, group]) => ({ subject, userIds: group.map((row) => row._id) }));
  const ambiguities = [
    ...[...subjectGroups]
      .filter(([, group]) => new Set(group.map((row) => row.societyId)).size < group.length)
      .map(([subject, group]) => ({
        kind: "subject-reused-within-society",
        key: subject,
        userIds: group.map((row) => row._id),
      })),
    ...[...emailGroups]
      .filter(([, group]) => group.length > 1)
      .map(([emailKey, group]) => ({
        kind: "duplicate-email-within-society",
        key: emailKey,
        userIds: group.map((row) => row._id),
      })),
  ];
  const rowsWithoutSubject = rows
    .filter((row) => !row.authSubject)
    .map((row) => ({ userId: row._id, societyId: row.societyId, email: row.email }));
  const disabledBindings = rows
    .filter((row) => row.status === "Disabled" && row.authSubject)
    .map((row) => ({ userId: row._id, subject: row.authSubject! }));

  return {
    source,
    totals: {
      users: rows.length,
      bound: rows.length - rowsWithoutSubject.length,
      unbound: rowsWithoutSubject.length,
    },
    duplicateSubjects,
    rowsWithoutSubject,
    ambiguities,
    disabledBindings,
  };
}

function identityRowsFromJson(value: unknown): IdentityRow[] {
  const candidate = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "users" in value
      ? (value as { users?: unknown }).users
      : undefined;
  if (!Array.isArray(candidate)) {
    throw new Error("Input must be a JSON users array or an object with a users array.");
  }
  return candidate.filter(
    (row): row is IdentityRow =>
      !!row && typeof row === "object" && "_id" in row && typeof row._id === "string",
  );
}

async function checkBindingBehavior() {
  const db = new MemoryDb({
    seed: {
      users: [
        {
          _id: "legacy-victim",
          societyId: "society-a",
          email: "member@example.org",
          displayName: "Legacy Member",
          role: "Owner",
          status: "Active",
          createdAtISO: "2025-01-01T00:00:00.000Z",
        },
        {
          _id: "bound-user",
          societyId: "society-b",
          email: "old@example.org",
          displayName: "Old Name",
          role: "Member",
          status: "Active",
          authProvider: "better-auth",
          authSubject: "bound-subject",
          createdAtISO: "2025-01-01T00:00:00.000Z",
        },
        {
          _id: "admin-user",
          societyId: "society-a",
          email: "admin@example.org",
          displayName: "Admin User",
          role: "Admin",
          status: "Active",
          authProvider: "better-auth",
          authSubject: "admin-subject",
          createdAtISO: "2025-01-01T00:00:00.000Z",
        },
        {
          _id: "operator-placeholder",
          societyId: "society-c",
          email: "owner@society-c.local",
          displayName: "Society C Owner",
          role: "Owner",
          status: "Active",
          createdAtISO: "2025-01-01T00:00:00.000Z",
        },
      ],
      invitations: [
        {
          _id: "valid-invite",
          societyId: "society-a",
          email: "member@example.org",
          role: "Director",
          token: "inv_valid",
          createdAtISO: "2026-01-01T00:00:00.000Z",
        },
        {
          _id: "revoked-invite",
          societyId: "society-a",
          email: "member@example.org",
          role: "Member",
          token: "inv_revoked",
          createdAtISO: "2026-01-01T00:00:00.000Z",
          revokedAtISO: "2026-01-02T00:00:00.000Z",
        },
        {
          _id: "bound-invite",
          societyId: "society-b",
          email: "new@example.org",
          role: "Owner",
          token: "inv_bound",
          createdAtISO: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });
  let principal: PortablePrincipal = {
    kind: "user",
    runtime: "test",
    assurance: "verified-jwt",
    issuer: "https://auth.example.test",
    authProvider: "better-auth",
    subject: "new-subject",
    email: "member@example.org",
    emailVerified: true,
    name: "Current Member",
  };
  const runtime = new PortableRuntime({
    db,
    capabilities: makeCapabilities({}),
    principalProvider: () => principal,
  })
    .register(definePortableMutation({
      name: "users:ensureCurrentMembership",
      handler: ensureCurrentMembershipPortable,
    }))
    .register(definePortableMutation({
      name: "invitations:accept",
      handler: acceptPortable,
    }))
    .register(definePortableMutation({
      name: "invitations:create",
      handler: createPortable,
    }))
    .register(definePortableMutation({
      name: "invitations:revoke",
      handler: revokePortable,
    }))
    .register(definePortableMutation({
      name: "society:createForIdentityCheck",
      handler: async (ctx, args: { name: string; officialEmail?: string }) => {
        const societyId = await ctx.db.insert("societies", {
          name: args.name,
          isCharity: false,
          isMemberFunded: false,
          updatedAt: Date.now(),
        });
        await seedNewSocietyOwnerPortable(ctx, {
          societyId,
          placeholderEmail: args.officialEmail ?? "owner@workspace.local",
          placeholderDisplayName: "Owner",
          createdAtISO: new Date().toISOString(),
        });
        return societyId;
      },
    }))
    .register(definePortableMutation({
      name: "apiPlatform:bootstrapUserIdentityForCheck",
      handler: bootstrapUserIdentityPortable,
    }));

  principal = {
    kind: "user",
    runtime: "test",
    assurance: "verified-jwt",
    issuer: "https://auth.example.test",
    authProvider: "better-auth",
    subject: "creator-subject",
    email: "creator@example.org",
    emailVerified: true,
    name: "Verified Creator",
  };
  const createdSocietyId = await runtime.runMutation<string>(
    "society:createForIdentityCheck",
    { name: "Creator Society", officialEmail: "placeholder@example.org" },
  );
  const creatorOwner = db.dump("users").find(
    (row) => row.societyId === createdSocietyId,
  );
  assert.equal(creatorOwner?.role, "Owner");
  assert.equal(creatorOwner?.authSubject, "creator-subject");
  assert.equal(creatorOwner?.authProvider, "better-auth");
  assert.equal(creatorOwner?.email, "creator@example.org");
  assert.equal(creatorOwner?.displayName, "Verified Creator");
  const creatorInvitationId = await runtime.runMutation<string>("invitations:create", {
    societyId: createdSocietyId,
    email: "invitee@example.org",
    role: "Member",
  });
  assert.equal((await db.get(creatorInvitationId))?.invitedByUserId, creatorOwner?._id);

  principal = {
    kind: "user",
    runtime: "test",
    assurance: "trusted-workspace",
    subject: "local-workspace",
    email: "local-user@example.org",
    name: "Local User",
  };
  const localSocietyId = await runtime.runMutation<string>(
    "society:createForIdentityCheck",
    { name: "Local Society", officialEmail: "local-placeholder@example.org" },
  );
  const localOwner = db.dump("users").find((row) => row.societyId === localSocietyId);
  assert.equal(localOwner?.email, "local-placeholder@example.org");
  assert.equal(localOwner?.displayName, "Owner");
  assert.equal(localOwner?.authSubject, undefined);
  assert.equal(localOwner?.authProvider, undefined);

  principal = {
    kind: "user",
    runtime: "test",
    assurance: "verified-jwt",
    issuer: "https://auth.example.test",
    authProvider: "better-auth",
    subject: "new-subject",
    email: "member@example.org",
    emailVerified: true,
    name: "Current Member",
  };

  const uninvited = await runtime.runMutation<MembershipResolution>(
    "users:ensureCurrentMembership",
    { societyId: "society-a" },
  );
  assert.deepEqual(uninvited, { status: "needs-invitation" });
  assert.equal((await db.get("legacy-victim"))?.authSubject, undefined);
  await assert.rejects(
    () => runtime.runMutation("invitations:create", {
      societyId: "society-a",
      email: "attacker@example.org",
      role: "Owner",
    }),
    /Authentication required/,
  );

  principal = {
    ...principal,
    subject: "admin-subject",
    email: "admin@example.org",
  };
  const managedInvitationId = await runtime.runMutation<string>("invitations:create", {
    societyId: "society-a",
    email: "managed@example.org",
    role: "Member",
  });
  assert.equal((await db.get(managedInvitationId))?.invitedByUserId, "admin-user");

  principal = {
    ...principal,
    subject: "new-subject",
    email: "attacker@example.org",
  };
  const wrongEmail = await runtime.runMutation<MembershipResolution>("invitations:accept", {
    token: "inv_valid",
  });
  assert.deepEqual(wrongEmail, { status: "invitation-email-mismatch" });
  assert.equal((await db.get("valid-invite"))?.acceptedAtISO, undefined);

  principal = { ...principal, email: "member@example.org" };
  const accepted = await runtime.runMutation<MembershipResolution>("invitations:accept", {
    token: "inv_valid",
  });
  assert.equal(accepted.status, "invitation-accepted");
  assert.equal((await db.get("legacy-victim"))?.authSubject, undefined);
  const created = db.dump("users").find((row) => row.authSubject === "new-subject");
  assert.equal(created?.role, "Director");
  assert.equal((await db.get("valid-invite"))?.acceptedByUserId, created?._id);

  const reused = await runtime.runMutation<MembershipResolution>("invitations:accept", {
    token: "inv_valid",
  });
  assert.deepEqual(reused, { status: "invitation-already-accepted" });
  const revoked = await runtime.runMutation<MembershipResolution>("invitations:accept", {
    token: "inv_revoked",
  });
  assert.deepEqual(revoked, { status: "invitation-revoked" });

  principal = {
    ...principal,
    subject: "bound-subject",
    email: "new@example.org",
    name: "New Name",
  };
  const bound = await runtime.runMutation<MembershipResolution>(
    "users:ensureCurrentMembership",
    { societyId: "society-b" },
  );
  assert.equal(bound.status, "bound");
  const updated = await db.get("bound-user");
  assert.equal(updated?.email, "new@example.org");
  assert.equal(updated?.displayName, "New Name");
  assert.equal(updated?.authSubject, "bound-subject");
  assert.equal(updated?.role, "Member");

  const acceptedByExisting = await runtime.runMutation<MembershipResolution>(
    "invitations:accept",
    { token: "inv_bound" },
  );
  assert.equal(acceptedByExisting.status, "invitation-accepted");
  assert.equal((await db.get("bound-invite"))?.acceptedByUserId, "bound-user");
  assert.equal((await db.get("bound-user"))?.role, "Member");

  await assert.rejects(
    () => runtime.runMutation("apiPlatform:bootstrapUserIdentityForCheck", {
      userId: "bound-user",
      authSubject: "replacement-subject",
      authProvider: "better-auth",
    }),
    /already bound to a different auth subject/,
  );
  assert.equal((await db.get("bound-user"))?.authSubject, "bound-subject");

  const bootstrappedId = await runtime.runMutation<string>(
    "apiPlatform:bootstrapUserIdentityForCheck",
    {
      userId: "operator-placeholder",
      authSubject: "operator-bound-subject",
      authProvider: "better-auth",
    },
  );
  assert.equal(bootstrappedId, "operator-placeholder");
  assert.equal((await db.get("operator-placeholder"))?.authSubject, "operator-bound-subject");
  const bindingAudit = db.dump("activity").find(
    (row) => row.subjectId === "operator-placeholder" && row.action === "identity-bound",
  );
  assert.equal(bindingAudit?.actor, "API platform operator");

  console.log("Identity binding behavior ok: creator bootstrap works; email rebinding is blocked; operator binding is audited.");
}

await checkBindingBehavior();

const inputIndex = process.argv.indexOf("--input");
const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
if (inputIndex >= 0 && !inputPath) throw new Error("--input requires a JSON file path.");
const source = inputPath ? path.resolve(inputPath) : "static portable fixture";
const rows = inputPath
  ? identityRowsFromJson(JSON.parse(readFileSync(source, "utf8")) as unknown)
  : identityRowsFromJson({ users: tables.users ?? [] });
const report = reconcile(rows, source);
console.log(JSON.stringify(report, null, 2));

if (
  report.duplicateSubjects.length ||
  report.ambiguities.length ||
  report.disabledBindings.length
) {
  process.exitCode = 1;
}
