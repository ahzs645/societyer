import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { validateWorkspaceProcurementReviewFolder } from "../../shared/procurementReview/paths";

export type CatalogGrant = { iss: string; aud: "procurement-catalog"; sub: string; societyId: string; folder: string; iat: number; exp: number };
export type WorkspaceBinding = { societyId: string; folder: string };
export class CatalogHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function safeIdentifier(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,180}$/.test(value)) throw new CatalogHttpError(400, "Invalid catalog identifier.");
  return value;
}
const decode = (part: string, maximum: number) => {
  if (part.length > maximum || !/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("Invalid grant encoding.");
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) throw new Error("Invalid grant encoding.");
  return JSON.parse(bytes.toString("utf8"));
};
export function grantVerifier(issuer: string, publicKeys: Record<string, string>, bindings: WorkspaceBinding[], now = () => Date.now()) {
  if (!issuer || !bindings.length) throw new Error("An issuer and explicit workspace allowlist are required.");
  const workspaces = new Map<string, WorkspaceBinding>();
  for (const binding of bindings) {
    safeIdentifier(binding.societyId);
    validateWorkspaceProcurementReviewFolder(binding.societyId, binding.folder);
    if (workspaces.has(binding.societyId)) throw new Error("Duplicate workspace binding.");
    workspaces.set(binding.societyId, binding);
  }
  const keys = new Map<string, KeyObject>();
  for (const [id, pem] of Object.entries(publicKeys)) {
    safeIdentifier(id);
    if (!pem.startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error("The catalog service must receive public verification keys only.");
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Catalog grants require a P-256 public key.");
    keys.set(id, key);
  }
  if (!keys.size) throw new Error("No grant verification keys configured.");
  return (authorization: string | undefined, workspaceId: string): CatalogGrant => {
    try {
      if (!authorization?.startsWith("Bearer ") || authorization.length > 10_000) throw new Error("Missing grant.");
      const parts = authorization.slice(7).split("."); if (parts.length !== 3) throw new Error("Invalid grant.");
      const header = decode(parts[0], 1000), claims = decode(parts[1], 8000), key = keys.get(header.kid);
      if (header.alg !== "ES256" || header.typ !== "JWT" || !key || !/^[A-Za-z0-9_-]{86}$/.test(parts[2])) throw new Error("Invalid signing algorithm or key.");
      const signature = Buffer.from(parts[2], "base64url");
      if (signature.toString("base64url") !== parts[2] || !verify("sha256", Buffer.from(parts[0] + "." + parts[1]), { key, dsaEncoding: "ieee-p1363" }, signature)) throw new Error("Invalid signature.");
      const seconds = Math.floor(now() / 1000), binding = workspaces.get(workspaceId);
      if (!binding || claims.iss !== issuer || claims.aud !== "procurement-catalog" || claims.societyId !== workspaceId || claims.folder !== binding.folder || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 256 || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > seconds + 30 || claims.exp <= seconds || claims.exp <= claims.iat || claims.exp - claims.iat > 600) throw new Error("Grant scope or lifetime is invalid.");
      return claims;
    } catch { throw new CatalogHttpError(401, "A current grant for this workspace is required."); }
  };
}
