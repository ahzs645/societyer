import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { z } from "zod";

export const PASSWORD_RESET_LINK_CHECK = "/check-password-reset-link";

export const passwordResetLink = {
  id: "societyer-password-reset-link",
  endpoints: {
    checkPasswordResetLink: createAuthEndpoint(PASSWORD_RESET_LINK_CHECK, {
      method: "POST",
      body: z.object({ token: z.string().min(1).max(512) }),
    }, async (ctx) => {
      // Both brokers store Better Auth reset tokens in the verification table.
      // A lookup leaves the token available for Better Auth's atomic reset.
      const verification = await ctx.context.adapter.findOne<{ expiresAt: Date | string | number }>({
        model: "verification",
        where: [{ field: "identifier", value: `reset-password:${ctx.body.token}` }],
      });
      ctx.setHeader("Cache-Control", "no-store");
      return ctx.json({ valid: verification !== null && new Date(verification.expiresAt).getTime() > Date.now() });
    }),
  },
} satisfies BetterAuthPlugin;
