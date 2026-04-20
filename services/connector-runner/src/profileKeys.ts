import crypto from "node:crypto";

const BLITZ_USER_DATA_ID = /^[a-zA-Z0-9-_]{1,64}$/;

export function normalizeProfileKey(value: string): string {
  const raw = String(value ?? "").trim();
  if (BLITZ_USER_DATA_ID.test(raw)) return raw;

  const hash = crypto
    .createHash("sha256")
    .update(raw || "empty-profile")
    .digest("base64url")
    .slice(0, 16);
  const prefix = raw
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "profile";

  return `${prefix}-${hash}`.slice(0, 64);
}
