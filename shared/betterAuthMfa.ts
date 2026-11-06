import { createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import type { DBAdapter } from "better-auth/types";

const sessionKey = (id: string) => `societyer-verified-second-factor:${id}`;

export async function betterAuthMfaClaims(
  adapter: Pick<DBAdapter, "findOne">,
  user: { id: string; twoFactorEnabled?: unknown },
  session: { id: string },
): Promise<Record<string, true>> {
  if (user.twoFactorEnabled !== true) return {};
  const proof = await adapter.findOne<{ value: string; expiresAt: Date | number | string }>({
    model: "verification",
    where: [{ field: "identifier", value: sessionKey(session.id) }],
  });
  return proof?.value === user.id && new Date(proof.expiresAt).getTime() > Date.now()
    ? { societyer_mfa_verified: true }
    : {};
}

/** Record proof only when successful Better Auth verification issues a session. */
export const workspaceMfaProof = {
  id: "societyer-workspace-mfa-proof",
  hooks: {
    after: [{
      matcher: ({ path }) => path === "/two-factor/verify-totp" || path === "/two-factor/verify-backup-code",
      handler: createAuthMiddleware(async ({ context }) => {
        const verified = context.newSession;
        if (!verified || verified.user.twoFactorEnabled !== true || context.returned instanceof Error) return;
        await context.internalAdapter.createVerificationValue({
          identifier: sessionKey(verified.session.id),
          value: verified.user.id,
          expiresAt: verified.session.expiresAt,
        });
      }),
    }],
  },
} satisfies BetterAuthPlugin;
