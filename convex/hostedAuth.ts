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
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import { sendEmail } from "./providers/email";
import { authSessionDurationSeconds, resolveConvexAuthSiteUrls, resolveSessionBroker } from "../shared/authConfiguration";

export const authComponent = createClient<DataModel>(components.betterAuth);

/** Verification and reset links need a mail sender; without one, accounts stay unverified. */
export function hostedAuthEmailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RESEND_API_KEY && (env.RESEND_FROM_EMAIL || env.RESEND_FROM));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function sendAuthLink(to: string, subject: string, intro: string, url: string, tag: string) {
  await sendEmail({
    to, subject, tag,
    text: `${intro}\n\n${url}\n\nIf you did not ask for this, you can ignore this email.`,
    html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(subject)}</a></p><p>If you did not ask for this, you can ignore this email.</p>`,
  });
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
  const clientIpHeader = process.env.AUTH_CLIENT_IP_HEADER?.trim().toLowerCase() || undefined;
  return betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    secret: secret || "inactive-convex-broker-placeholder-secret-0000",
    trustedOrigins: siteUrls,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // With mail configured, an account must prove its mailbox before it can
      // sign in. Invitations always require a verified email.
      requireEmailVerification: emailConfigured,
      ...(emailConfigured ? {
        sendResetPassword: async ({ user, url }) =>
          sendAuthLink(user.email, "Reset your Societyer password", "Use this link to choose a new password. It expires in one hour.", url, "auth-reset-password"),
      } : {}),
    },
    ...(emailConfigured ? {
      emailVerification: {
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: false,
        sendVerificationEmail: async ({ user, url }) =>
          sendAuthLink(user.email, "Verify your Societyer email", "Confirm this email address to finish creating your Societyer account.", url, "auth-verify-email"),
      },
    } : {}),
    account: {
      // Same policy as the gateway broker: a matching email never links accounts.
      accountLinking: { enabled: false, disableImplicitLinking: true, trustedProviders: [] },
    },
    session: { expiresIn: authSessionDurationSeconds(process.env), disableSessionRefresh: true },
    // Better Auth throttles per client IP. Convex HTTP actions don't receive one
    // unless a trusted proxy in front adds it, and without an IP every visitor
    // would share one sign-in bucket, so throttling needs the proxy's header.
    // Convex isolates keep no memory between requests: count in the database.
    rateLimit: { enabled: Boolean(clientIpHeader), storage: "database" },
    advanced: { ipAddress: clientIpHeader ? { ipAddressHeaders: [clientIpHeader] } : { disableIpTracking: true } },
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
