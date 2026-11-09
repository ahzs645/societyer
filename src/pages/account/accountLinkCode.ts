/**
 * The pending link code from `accountLinks:begin`. Kept only in this tab's
 * sessionStorage, never in a URL, and dropped once it expires or the link ends.
 */
const KEY = "societyer.accountLink.code";

export type PendingLinkCode = { code: string; expiresAtISO: string };

export function saveLinkCode(value: PendingLinkCode) {
  try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Without storage the confirm page asks to start again. */ }
}

export function readLinkCode(now = Date.now()): PendingLinkCode | null {
  let value: unknown = null;
  try { value = JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { value = null; }
  const pending = value as Partial<PendingLinkCode> | null;
  if (
    pending && typeof pending.code === "string" && pending.code &&
    typeof pending.expiresAtISO === "string" && Date.parse(pending.expiresAtISO) > now
  ) return { code: pending.code, expiresAtISO: pending.expiresAtISO };
  if (value !== null) clearLinkCode();
  return null;
}

export function clearLinkCode() {
  try { sessionStorage.removeItem(KEY); } catch { /* Nothing stored. */ }
}
