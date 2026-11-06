import { decodeJwt } from "jose";
import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { hostedPrincipal } from "./lib/authIdentity";
import { CLERK_MFA_SESSION_PATH, clerkSecondFactorVerified } from "../shared/workspaceMfa";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization",
  "Cache-Control": "no-store",
};

export function registerWorkspaceMfaRoutes(http: HttpRouter) {
  http.route({
    path: CLERK_MFA_SESSION_PATH,
    method: "OPTIONS",
    handler: httpAction(async () => new Response(null, { status: 204, headers })),
  });
  http.route({
    path: CLERK_MFA_SESSION_PATH,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      // Convex authenticates this request's Authorization bearer JWT. Decode
      // the same header to read Clerk's fva claim, which Convex omits from the
      // reactive identity to avoid rerunning queries on every token refresh.
      const principal = hostedPrincipal(await ctx.auth.getUserIdentity());
      const token = request.headers.get("Authorization")?.match(/^Bearer ([^\s,]+)$/i)?.[1];
      if (principal.kind !== "user" || principal.authProvider !== "clerk" ||
          principal.gatewayService || !principal.issuer || !principal.authSessionId || !token) {
        return new Response(null, { status: 401, headers });
      }
      let payload;
      try {
        payload = decodeJwt(token);
      } catch {
        return new Response(null, { status: 401, headers });
      }
      const origin = request.headers.get("Origin");
      if (payload.iss !== principal.issuer || payload.sub !== principal.subject ||
          payload.sid !== principal.authSessionId || payload.sts === "pending" ||
          payload.act || (origin && typeof payload.azp === "string" && origin !== payload.azp) ||
          !clerkSecondFactorVerified(payload.fva)) {
        return new Response(null, { status: 403, headers });
      }
      await ctx.runMutation(internal.workspaceMfa.recordClerkSession, {
        issuer: principal.issuer, subject: principal.subject, sessionId: principal.authSessionId,
      });
      return new Response(null, { status: 204, headers });
    }),
  });
}
