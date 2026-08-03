import type {
  PortableDoc,
  PortableMutationCtx,
  PortablePrincipal,
  TransactionalDb,
} from "../shared/portable/index";

export const PORTABLE_TEST_AUTH_SUBJECT = "test:portable-fixture-owner";

export const PORTABLE_TEST_IDENTITY = {
  subject: PORTABLE_TEST_AUTH_SUBJECT,
  issuer: "https://portable-fixture.test",
  tokenIdentifier: `https://portable-fixture.test|${PORTABLE_TEST_AUTH_SUBJECT}`,
};

export function portableTestPrincipal(): PortablePrincipal {
  return {
    kind: "user",
    runtime: "test",
    assurance: "trusted-workspace",
    subject: PORTABLE_TEST_AUTH_SUBJECT,
  };
}

export async function seedPortableTestMembership(
  ctx: Pick<PortableMutationCtx, "db">,
  societyId: string,
): Promise<string> {
  return ctx.db.insert("users", {
    societyId,
    email: "owner@portable-fixture.test",
    displayName: "Portable fixture owner",
    role: "Owner",
    status: "Active",
    authProvider: "portable-fixture",
    authSubject: PORTABLE_TEST_AUTH_SUBJECT,
    createdAtISO: "2026-01-01T00:00:00.000Z",
  });
}

export function portableTestSeed(societyId: string): Record<string, PortableDoc[]> {
  return {
    societies: [{ _id: societyId, name: "Portable fixture society" }],
    users: [{
      _id: `${societyId}_owner`,
      societyId,
      email: "owner@portable-fixture.test",
      displayName: "Portable fixture owner",
      role: "Owner",
      status: "Active",
      authProvider: "portable-fixture",
      authSubject: PORTABLE_TEST_AUTH_SUBJECT,
      createdAtISO: "2026-01-01T00:00:00.000Z",
    }],
  };
}

export async function createPortableTestWorkspace(
  db: TransactionalDb,
  name = "Portable fixture society",
): Promise<string> {
  return db.transaction(async () => {
    const societyId = await db.insert("societies", { name });
    await seedPortableTestMembership({ db }, societyId);
    return societyId;
  });
}
