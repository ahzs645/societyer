import "./env";
import { verifyToken } from "@clerk/backend";
import { resolveClerkIssuer } from "../shared/authConfiguration";

function authError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** Validate deployment configuration before accepting any Clerk credentials. */
export function clerkVerificationConfig() {
  let issuer: string | undefined;
  try { issuer = resolveClerkIssuer(process.env); } catch { /* Report the existing structured configuration error below. */ }
  const parties = process.env.CLERK_AUTHORIZED_PARTIES?.split(",")
    .map((value) => value.trim()).filter(Boolean) ?? [];
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const jwtKey = process.env.CLERK_JWT_KEY?.trim();
  let validOrigins = false;
  try {
    const issuerUrl = new URL(issuer ?? "");
    validOrigins = issuerUrl.protocol === "https:" && issuerUrl.origin === issuer
      && parties.length > 0 && parties.every((party) => {
        const url = new URL(party);
        return (url.protocol === "https:" || url.protocol === "http:") && url.origin === party;
      });
  } catch {
    // Missing or malformed issuer/origins are configuration errors, not a reason
    // to accept credentials using SDK defaults.
  }
  if (!validOrigins || (!secretKey && !jwtKey)) {
    throw authError(503, "clerk_not_configured",
      "Clerk requires CLERK_JWT_ISSUER_DOMAIN, CLERK_AUTHORIZED_PARTIES, and CLERK_SECRET_KEY or CLERK_JWT_KEY.");
  }
  return { issuer: issuer!, authorizedParties: parties, secretKey, jwtKey };
}

/** Verify the same audience-bound token the browser passes directly to Convex. */
export async function verifyClerkConvexToken(token: string) {
  const config = clerkVerificationConfig();
  try {
    const payload = await verifyToken(token, {
      secretKey: config.secretKey,
      jwtKey: config.jwtKey,
      audience: "convex",
      authorizedParties: config.authorizedParties,
      clockSkewInMs: 0,
    });
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    // SDK authorized-party validation permits missing azp. Our gateway requires
    // it explicitly, and pins the issuer rather than trusting token metadata.
    if (payload.iss !== config.issuer || !audiences.includes("convex")
      || typeof payload.azp !== "string" || !config.authorizedParties.includes(payload.azp)
      || payload.sts === "pending"
      || typeof payload.sub !== "string" || !payload.sub) {
      throw new Error("Clerk token claims do not match this deployment.");
    }
    return { subject: payload.sub, issuer: payload.iss };
  } catch {
    throw authError(401, "invalid_clerk_token", "The Clerk workspace token is invalid or expired.");
  }
}

/** The verified stored binding controls the effective identity for machine calls. */
export function machinePrincipalClaims(binding: {
  authSubject: string;
  authIssuer?: string;
  authProvider?: string;
}) {
  return {
    sub: binding.authSubject,
    ...(binding.authIssuer ? { societyer_auth_issuer: binding.authIssuer } : {}),
    ...(binding.authProvider ? { societyer_auth_provider: binding.authProvider } : {}),
  };
}
