import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { grantVerifier } from "../server/procurement-catalog/grants";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const now = 1_794_326_400_000, issuer = "https://issuer.example.invalid", societyId = "fictional-ddc", folder = "Zoer/bc-bid-monitor/fictional-ddc";
const verifier = grantVerifier(issuer, { fixture: publicKey.export({ type: "spki", format: "pem" }).toString() }, [{ societyId, folder }], () => now);
const token = (changes = {}, headerChanges = {}) => {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "fixture", ...headerChanges })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: "procurement-catalog", sub: "fictional-user", societyId, folder, iat: now / 1000, exp: now / 1000 + 600, ...changes })).toString("base64url");
  const signature = sign("sha256", Buffer.from(header + "." + payload), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return "Bearer " + header + "." + payload + "." + signature;
};
assert.equal(verifier(token(), societyId).sub, "fictional-user");
for (const changes of [{ exp: now / 1000 }, { exp: now / 1000 + 601 }, { iat: now / 1000 + 100 }, { societyId: "other" }, { folder: "other" }, { iss: "other" }, { aud: "other" }]) assert.throws(() => verifier(token(changes), societyId));
for (const header of [{ alg: "none" }, { kid: "unknown" }, { typ: "other" }]) assert.throws(() => verifier(token({}, header), societyId));
assert.throws(() => verifier(undefined, societyId));
assert.throws(() => verifier(token(), "other"));
const original = token(); assert.throws(() => verifier(original.slice(0, -3) + "aaa", societyId));
console.log("Catalog grants passed: ES256 signature, fixed issuer/audience, exact workspace/folder, expiry, maximum lifetime, key selection, anonymous and tampered-token denial.");
