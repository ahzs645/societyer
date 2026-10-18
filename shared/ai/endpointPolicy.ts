/**
 * Where an AI endpoint may point, by runtime.
 *
 * - Hosted / self-hosted server: a workspace-supplied base URL is fetched by
 *   the server, so it must be public HTTPS (no loopback, private, link-local,
 *   metadata or internal names). This reuses the shared outbound URL policy.
 * - On-device (browser-local workspace or desktop app): the request leaves this
 *   computer from this computer, so loopback and LAN servers (Ollama, LM Studio,
 *   llama.cpp) are the expected case. Plain HTTP is accepted only for loopback
 *   and private-network hosts; anything public must be HTTPS.
 */
import { isInternalHostname, isPrivateOrReservedAddress, validateOutboundUrl, type OutboundUrlPolicyOptions } from "../outboundUrlPolicy";

export type EndpointCheck = { ok: true; url: URL } | { ok: false; message: string };

function hostOf(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/** 127.0.0.0/8, ::1, localhost and *.localhost. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (host === "::ffff:127.0.0.1" || host.startsWith("::ffff:7f")) return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** True when the base URL is on this computer, so no API key is needed. */
export function isLoopbackUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    return isLoopbackHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/** Server-side check for a workspace-supplied AI base URL. */
export function checkHostedAiBaseUrl(raw: string, options: OutboundUrlPolicyOptions = {}): EndpointCheck {
  try {
    return { ok: true, url: validateOutboundUrl(raw.trim(), options).url };
  } catch {
    return { ok: false, message: "This AI provider address is not allowed on a server workspace. Use a public https:// address." };
  }
}

/** Device-side check for the on-device AI base URL. */
export function checkDeviceAiBaseUrl(raw: string): EndpointCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: "Enter a full address, for example http://127.0.0.1:11434/v1." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, message: "The address must start with http:// or https://." };
  if (url.username || url.password) return { ok: false, message: "Put the API key in the key field, not in the address." };
  if (url.search || url.hash) return { ok: false, message: "Remove the query string from the address." };
  const host = hostOf(url);
  const local = isLoopbackHost(host) || isPrivateOrReservedAddress(host) || isInternalHostname(host);
  if (url.protocol === "http:" && !local) return { ok: false, message: "Use https:// for a server that is not on this computer or your local network." };
  return { ok: true, url };
}

/** Base URL with no trailing slash, e.g. "http://127.0.0.1:11434/v1". */
export function normalizeAiBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}
