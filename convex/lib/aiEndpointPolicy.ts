// Outbound policy for workspace-supplied AI provider addresses.
//
// A workspace admin can save an "OpenAI-compatible" base URL. On a hosted or
// self-hosted server that URL is fetched by the server, so it must not reach
// loopback, private, link-local or cloud-metadata hosts. This applies the same
// outbound URL policy as webhooks and grant feeds (public HTTPS only, with the
// existing local-development escape hatch), refuses redirects, and never
// returns provider response bodies to the caller.
import { assertConvexOutboundUrl } from "./outboundUrlPolicy";

export const HOSTED_AI_ADDRESS_REJECTED =
  "This AI provider address is not allowed on a server workspace. Use a public https:// address.";

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Throws OutboundUrlPolicyError when the address may not be fetched by the server. */
export function assertHostedAiUrl(rawUrl: string, operation: string) {
  return assertConvexOutboundUrl(rawUrl, { source: "tenant", operation });
}

/** True when the server may fetch this AI base URL. */
export function isHostedAiUrlAllowed(rawUrl: string, operation: string): boolean {
  try {
    assertHostedAiUrl(rawUrl, operation);
    return true;
  } catch {
    return false;
  }
}

/**
 * A fetch for AI SDK providers built from workspace settings: every request
 * URL is policy-checked and redirects are refused (a redirect could otherwise
 * point the request, and its API key, at a private host).
 */
export function hostedAiFetch(operation: string): typeof fetch {
  const guarded = async (input: string | URL | Request, init?: RequestInit) => {
    assertHostedAiUrl(requestUrl(input), operation);
    return fetch(input, { ...init, redirect: "error" });
  };
  return guarded as typeof fetch;
}
