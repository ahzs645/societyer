/**
 * Convex-hosted session broker (AUTH_MODE=convex).
 *
 * Better Auth runs inside this deployment through the `@convex-dev/better-auth`
 * component: login accounts, sessions and signing keys live in the component's
 * tables and its routes are served from the deployment's HTTP actions origin,
 * so no separate auth server or database is needed. The component only proves
 * who someone is. Workspace access still comes from `users` memberships,
 * created by workspace creation or invitation acceptance.
 */
import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { generateRandomString } from "better-auth/crypto";
import { APIError, createAuthMiddleware, createEmailVerificationToken } from "better-auth/api";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import { hostedSessionConfiguration, resolveConvexAuthSiteUrls, resolveSessionBroker } from "../shared/authConfiguration";
import { allowedAuthEmailDomains, authEmailAllowed, authEmailPolicyMessage } from "../shared/authEmailPolicy";
import { emailProviderConfiguration } from "../shared/emailConfiguration";
import { developmentMailConfigured, assertDevelopmentMail } from "../shared/developmentMailConfiguration";

export const authComponent = createClient<DataModel>(components.betterAuth);

/** Verification and reset links need a mail sender; without one, accounts stay unverified. */
export function hostedAuthEmailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  if (env.SOCIETYER_AUTH_DEVELOPMENT_MAIL === "1") return developmentMailConfigured(env);
  return emailProviderConfiguration(env).live;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function sendAuthLink(ctx: GenericCtx<DataModel>, to: string, subject: string, intro: string, url: string, tag: "auth-verify-email" | "auth-reset-password") {
  const text = `${intro}\n\n${url}\n\nIf you did not ask for this, you can ignore this email.`;
  if (process.env.SOCIETYER_AUTH_DEVELOPMENT_MAIL === "1") {
    assertDevelopmentMail(process.env);
    if (!("runMutation" in ctx)) throw new Error("Development mail requires an action context.");
    await ctx.runMutation(internal.developmentMail.capture, { to, subject, text, tag });
    return;
  }
  if (!("runMutation" in ctx)) throw new Error("Auth email requires an action context.");
  await ctx.runMutation(internal.authEmails.enqueue, {
    to, subject, tag,
    text,
    html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(subject)}</a></p><p>If you did not ask for this, you can ignore this email.</p>`,
  });
}

type Allowance = { capacity: number; perHour: number };
/**
 * Attempts allowed per account email and per client IP, as token buckets: up
 * to `capacity` at once, refilling `perHour`. Sign-in refills the account's
 * bucket on success, so only failures add up there. The email limits on
 * sign-up and email-sending routes bound how much mail one address receives.
 */
const THROTTLES: Record<string, { email?: Allowance; ip?: Allowance }> = {
  "/sign-in/email": { email: { capacity: 10, perHour: 10 }, ip: { capacity: 30, perHour: 60 } },
  "/sign-up/email": { email: { capacity: 3, perHour: 3 }, ip: { capacity: 10, perHour: 10 } },
  "/request-password-reset": { email: { capacity: 3, perHour: 3 }, ip: { capacity: 10, perHour: 10 } },
  "/send-verification-email": { email: { capacity: 3, perHour: 3 }, ip: { capacity: 10, perHour: 10 } },
  "/reset-password": { ip: { capacity: 10, perHour: 10 } },
};

const throttleEmail = (body: unknown) => {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase().slice(0, 320) : undefined;
};

/** Client IP from Convex request metadata; null outside an HTTP request. */
async function clientIp(ctx: GenericCtx<DataModel>): Promise<string | null> {
  const meta = (ctx as { meta?: { getRequestMetadata?: () => Promise<{ ip: string | null }> } }).meta;
  return meta?.getRequestMetadata ? (await meta.getRequestMetadata()).ip : null;
}

function throttleHooks(ctx: GenericCtx<DataModel>, domains: readonly string[], emailConfigured: boolean) {
  // Only HTTP requests (actions) reach these routes; other callers build a static instance.
  if (!("runMutation" in ctx)) return {};
  return {
    before: createAuthMiddleware(async (hook) => {
      if (domains.length && ["/sign-up/email", "/sign-in/email", "/change-email"].includes(hook.path)) {
        const email = hook.path === "/change-email" ? hook.body?.newEmail : hook.body?.email;
        if (!authEmailAllowed(email, domains)) throw new APIError("FORBIDDEN", { message: authEmailPolicyMessage(domains) });
        if (hook.path === "/sign-up/email" && !emailConfigured) {
          throw new APIError("FORBIDDEN", { message: "Sign-up is temporarily unavailable while email verification is being configured." });
        }
      }
      const rule = THROTTLES[hook.path];
      if (!rule) return;
      const email = throttleEmail(hook.body);
      const ip = await clientIp(ctx);
      const buckets = [
        ...(rule.email && email ? [{ key: `${hook.path}:email:${email}`, ...rule.email }] : []),
        ...(rule.ip && ip ? [{ key: `${hook.path}:ip:${ip}`, ...rule.ip }] : []),
      ];
      if (!buckets.length) return;
      const { ok, retryAfterMs } = await ctx.runMutation(internal.authThrottle.take, { buckets });
      if (!ok) {
        const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
        throw new APIError("TOO_MANY_REQUESTS", {
          message: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        });
      }
    }),
    after: createAuthMiddleware(async (hook) => {
      if (hook.path !== "/sign-in/email" || hook.context.returned instanceof Error) return;
      const email = throttleEmail(hook.body);
      if (email) await ctx.runMutation(internal.authThrottle.reset, { key: `${hook.path}:email:${email}` });
    }),
  };
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  // Route registration builds a static instance at deploy time; only a
  // selected Convex broker needs real site and secret configuration.
  const active = resolveSessionBroker(process.env) === "convex";
  const siteUrls = active ? resolveConvexAuthSiteUrls(process.env) : ["http://127.0.0.1:5173"];
  const secret = process.env.BETTER_AUTH_SECRET;
  if (active && (!secret || secret.length < 32)) {
    throw new Error("AUTH_MODE=convex requires a BETTER_AUTH_SECRET of at least 32 characters on the Convex deployment.");
  }
  const emailConfigured = hostedAuthEmailConfigured();
  const domains = allowedAuthEmailDomains(process.env);
  const checkEmail = (email: unknown) => {
    if (!authEmailAllowed(email, domains)) throw new APIError("FORBIDDEN", { message: authEmailPolicyMessage(domains) });
  };
  return betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    secret: secret || "inactive-convex-broker-placeholder-secret-0000",
    trustedOrigins: siteUrls,
    database: authComponent.adapter(ctx),
    databaseHooks: {
      user: {
        create: { before: async (user) => { checkEmail(user.email); } },
        update: { before: async (user) => { if (user.email !== undefined) checkEmail(user.email); } },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: domains.length > 0 && !emailConfigured,
      minPasswordLength: 10,
      // A reset ends every session, including one an attacker may hold.
      revokeSessionsOnPasswordReset: true,
      // With mail configured, an account must prove its mailbox before it can
      // sign in. Invitations always require a verified email.
      requireEmailVerification: emailConfigured || domains.length > 0,
      ...(emailConfigured ? {
        // Duplicate signup deliberately returns generic success. Resend a link
        // for an existing unverified account instead of silently doing nothing.
        onExistingUserSignUp: async ({ user }, request) => {
          if (user.emailVerified) return;
          let callbackURL = `${siteUrls[0]}/login?verified=1`;
          try {
            const body = await request?.json();
            const candidate = new URL(body?.callbackURL);
            if (siteUrls.some(site => new URL(site).origin === candidate.origin)) callbackURL = candidate.href;
          } catch { /* The primary app sign-in is the safe fallback. */ }
          const token = await createEmailVerificationToken(secret!, user.email, undefined, 60 * 60);
          const url = `${process.env.CONVEX_SITE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callbackURL)}`;
          await sendAuthLink(ctx, user.email, "Verify your Societyer email", "Confirm this email address to finish creating your Societyer account.", url, "auth-verify-email");
        },
        sendResetPassword: async ({ user, url }) =>
          sendAuthLink(ctx, user.email, "Reset your Societyer password", "Use this link to choose a new password. It expires in one hour.", url, "auth-reset-password"),
      } : {}),
    },
    ...(emailConfigured ? {
      emailVerification: {
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: false,
        sendVerificationEmail: async ({ user, url }) =>
          sendAuthLink(ctx, user.email, "Verify your Societyer email", "Confirm this email address to finish creating your Societyer account.", url, "auth-verify-email"),
      },
    } : {}),
    account: {
      // Same policy as the gateway broker: a matching email never links accounts.
      accountLinking: { enabled: false, disableImplicitLinking: true, trustedProviders: [] },
    },
    session: hostedSessionConfiguration(process.env),
    // Better Auth's limiter reads the client IP from request headers, which
    // Convex doesn't forward, and would put every visitor in one shared bucket.
    // `throttleHooks` limits by account and by Convex's own client IP instead.
    rateLimit: { enabled: false },
    advanced: { ipAddress: { disableIpTracking: true } },
    hooks: throttleHooks(ctx, domains, emailConfigured),
    plugins: [
      crossDomain({ siteUrl: siteUrls[0] }),
      convex({
        authConfig,
        jwt: {
          expirationSeconds: 5 * 60,
          // Convex passes custom-JWT claims through under their own names, so
          // `emailVerified` (not OIDC's `email_verified`) is what identity exposes.
          definePayload: ({ user }) => ({ email: user.email, emailVerified: user.emailVerified === true, name: user.name }),
        },
      }),
    ],
  });
};

/**
 * Operator-only recovery when the deployment has no mail sender: returns a
 * one-hour password-reset link to hand to the account holder yourself.
 *
 *   npx convex run hostedAuth:issuePasswordResetLink '{"email":"sam@example.org"}'
 *
 * Internal, so only someone with deployment access (CLI or dashboard) can run
 * it. Workspace Owners can't: an account may belong to other workspaces, and
 * resetting its password would hand over those too. Using the link ends the
 * account's other sessions.
 */
export const issuePasswordResetLink = internalAction({
  args: { email: v.string(), appUrl: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, { email, appUrl }) => {
    if (resolveSessionBroker(process.env) !== "convex") throw new Error("Reset links are for AUTH_MODE=convex deployments.");
    const auth = createAuth(ctx);
    const authContext = await auth.$context;
    const account = await authContext.internalAdapter.findUserByEmail(email.trim().toLowerCase());
    if (!account) throw new Error(`No account uses ${email.trim()}.`);
    const token = generateRandomString(32);
    await authContext.internalAdapter.createVerificationValue({
      identifier: `reset-password:${token}`,
      value: account.user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    // The app's own reset page; pass appUrl when it is served under a sub-path.
    const base = (appUrl ?? resolveConvexAuthSiteUrls(process.env)[0]).replace(/\/+$/, "");
    console.log(`Issued a password-reset link for account ${account.user.id}.`);
    return `${base}/reset-password?token=${encodeURIComponent(token)}`;
  },
});
