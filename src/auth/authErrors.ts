/**
 * Plain-language messages for Better Auth failures on the sign-in, sign-up,
 * forgot-password and reset-password screens. The server's own message is the
 * fallback, so anything not recognised here (e.g. the email-domain policy)
 * still reaches the user verbatim.
 */

export type AuthFailureKind =
  | "credentials"
  | "rate-limit"
  | "network"
  | "password-short"
  | "account-exists"
  | "invalid-token"
  | "other";

export class AuthFailure extends Error {
  constructor(readonly kind: AuthFailureKind, message: string) {
    super(message);
    this.name = "AuthFailure";
  }
}

/** The `error` member of a Better Auth client result. */
export type AuthResponseError = {
  status?: number;
  code?: string;
  message?: string;
};

const NETWORK_MESSAGE = "Can't reach the server. Check your connection.";

/** "Too many attempts. Try again in 6 minutes." keeps its wait; otherwise a minute. */
function rateLimitMessage(serverMessage: string | undefined) {
  const minutes = Number(serverMessage?.match(/(\d+)\s*minute/i)?.[1] ?? 1);
  return minutes > 1
    ? `Too many attempts. Wait ${minutes} minutes and try again.`
    : "Too many attempts. Wait a minute and try again.";
}

export function authFailureFromResponse(
  error: AuthResponseError,
  fallback: string,
  { minPasswordLength = 10 }: { minPasswordLength?: number } = {},
): AuthFailure {
  const code = error.code ?? "";
  if (error.status === 429 || code === "TOO_MANY_REQUESTS" || /too many/i.test(error.message ?? "")) {
    return new AuthFailure("rate-limit", rateLimitMessage(error.message));
  }
  if (code === "INVALID_EMAIL_OR_PASSWORD" || code === "INVALID_PASSWORD") {
    return new AuthFailure("credentials", "That email and password don't match.");
  }
  if (code === "PASSWORD_TOO_SHORT") {
    return new AuthFailure("password-short", `That password is too short. Use at least ${minPasswordLength} characters.`);
  }
  if (code === "PASSWORD_TOO_LONG") {
    return new AuthFailure("other", "That password is too long. Use 128 characters or fewer.");
  }
  if (code.startsWith("USER_ALREADY_EXISTS")) {
    return new AuthFailure("account-exists", "An account already uses this email.");
  }
  if (code === "INVALID_TOKEN") {
    return new AuthFailure("invalid-token", "This reset link doesn't work.");
  }
  return new AuthFailure("other", error.message || fallback);
}

/** Normalises anything thrown during an auth request, including fetch failures. */
export function toAuthFailure(cause: unknown, fallback: string): AuthFailure {
  if (cause instanceof AuthFailure) return cause;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  // fetch() rejects with a TypeError: "Failed to fetch" (Chromium), "Load
  // failed" (Safari), "NetworkError when attempting to fetch resource" (Firefox).
  // A lazily loaded auth client that can't be downloaded fails the same way.
  if (offline || (cause instanceof TypeError && /fetch|network|load failed|import/i.test(cause.message))) {
    return new AuthFailure("network", NETWORK_MESSAGE);
  }
  return new AuthFailure("other", cause instanceof Error && cause.message ? cause.message : fallback);
}
