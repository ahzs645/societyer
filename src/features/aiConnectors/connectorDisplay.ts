/**
 * What the AI connector screens say about a token, a connected app or an app
 * asking to connect. Pure, so scripts/check-mcp-oauth.ts can pin the wording.
 */
import type { ToneVariant } from "../../components/ui";
import { withoutInvisibleCharacters } from "../../../shared/mcp/oauth";

export type ConnectorStatusInput = {
  kind: "token" | "oauth";
  revokedAtISO?: string;
  expiresAtISO: string;
  /** The workspace opt-in (Settings → AI connectors). */
  connectorsEnabled: boolean;
};
export type ConnectorStatus = {
  state: "active" | "paused" | "revoked" | "expired";
  label: string;
  tone: ToneVariant;
  /** Why it isn't working, shown next to the badge. */
  note?: string;
  /** Not revoked or expired, so it can still be revoked or disconnected. */
  live: boolean;
  /** The dated line under the name, e.g. "Expires Jan 4, 2027". */
  dateLabel: string;
  dateISO: string;
};

/**
 * Revoked (or, for an app, disconnected) and expired are final. A live one is
 * paused while the workspace opt-in is off: every call is refused, but it
 * works again when connectors are turned back on.
 */
export function connectorStatus(grant: ConnectorStatusInput, nowMs: number): ConnectorStatus {
  if (grant.revokedAtISO) {
    const label = grant.kind === "oauth" ? "Disconnected" : "Revoked";
    return { state: "revoked", label, tone: "neutral", live: false, dateLabel: label, dateISO: grant.revokedAtISO };
  }
  if (Date.parse(grant.expiresAtISO) <= nowMs) return { state: "expired", label: "Expired", tone: "danger", live: false, dateLabel: "Expired", dateISO: grant.expiresAtISO };
  const expires = { live: true, dateLabel: "Expires", dateISO: grant.expiresAtISO };
  if (!grant.connectorsEnabled) return { state: "paused", label: "Paused", tone: "warn", note: "Connectors are off for this workspace", ...expires };
  return { state: "active", label: "Active", tone: "success", ...expires };
}

export type ConsentClientInput = {
  name: string;
  /** The metadata document's host (CIMD clients). */
  host: string | null;
  registration: "cimd" | "dcr";
  redirectHost: string;
  loopback: boolean;
};
export type ConsentIdentity = {
  /** The page title, e.g. "Connect Claude". */
  title: string;
  /** Who is asking, mid-sentence: the privacy note and the "I just started connecting …" gate. */
  name: string;
  /** A smaller line under it: who publishes the app, or what an unverified app calls itself. */
  secondary: string | null;
  verified: boolean;
};

/**
 * Who the consent page says is asking. A metadata-document (CIMD) app's name is
 * backed by the host that publishes it. A self-registered (DCR) app can call
 * itself anything, so it is named by the one thing Societyer checks, where it
 * returns, and its own name is only quoted.
 */
export function consentIdentity(client: ConsentClientInput): ConsentIdentity {
  const name = withoutInvisibleCharacters(client.name);
  if (client.registration === "cimd") {
    const host = client.host ? withoutInvisibleCharacters(client.host) : null;
    return { title: `Connect ${name}`, name, secondary: host ? `Published by ${host}` : null, verified: true };
  }
  const where = client.loopback ? "on this computer" : `at ${withoutInvisibleCharacters(client.redirectHost)}`;
  return { title: `Connect an app ${where}`, name: `the app ${where}`, secondary: `Calls itself “${name}”`, verified: false };
}
