import crypto from "node:crypto";

const OPAQUE_PROFILE_KEY = /^pk1_([a-zA-Z0-9_-]{12})_([a-zA-Z0-9_-]{32})$/;

function digest(value: string, length: number): string {
  return crypto.createHash("sha256").update(value).digest("base64url").slice(0, length);
}

function namespaceDigest(tenantKey: string, connectorId: string): string {
  return digest(`namespace\0${tenantKey}\0${connectorId}`, 12);
}

export type ProfileIdentity = {
  profileKey: string;
  userDataId: string;
};

export function deriveProfileIdentity(
  tenantKey: string,
  connectorId: string,
  requestedProfileKey: string,
): ProfileIdentity {
  const tenant = tenantKey.trim();
  const connector = connectorId.trim();
  const requested = requestedProfileKey.trim();
  if (!tenant || !connector || !requested) {
    throw new Error("tenantKey, connectorId, and profileKey are required.");
  }

  const namespace = namespaceDigest(tenant, connector);
  const opaqueMatch = OPAQUE_PROFILE_KEY.exec(requested);
  if (opaqueMatch) {
    if (opaqueMatch[1] !== namespace) {
      throw new Error("Browser profile does not belong to this tenant and connector.");
    }
    return { profileKey: requested, userDataId: requested };
  }

  // Raw/legacy labels are deliberately mapped to a new namespaced ID. This
  // invalidates old unnamespaced BlitzBrowser data instead of adopting it.
  const profileKey = `pk1_${namespace}_${digest(`profile\0${tenant}\0${connector}\0${requested}`, 32)}`;
  return { profileKey, userDataId: profileKey };
}
