"use node";
import { createPrivateKey, sign } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { authorizedAction } from "./lib/authorizedServer";

export const grant = authorizedAction("procurementCatalogActions:grant", action)({
  args: { societyId: v.id("societies") },
  returns: v.object({ token: v.string(), expiresAt: v.number(), baseUrl: v.string() }),
  handler: async (ctx, { societyId }) => {
    const scope = await ctx.runQuery(makeFunctionReference<"query", { societyId: typeof societyId }, { userId: string; folder: string; baseUrl: string }>("procurementCatalog:authorizeGrant"), { societyId });
    const issuer = process.env.CONVEX_SITE_URL, kid = process.env.PROCUREMENT_CATALOG_SIGNING_KEY_ID, pem = process.env.PROCUREMENT_CATALOG_SIGNING_KEY;
    if (!issuer || !kid || !/^[A-Za-z0-9_-]{1,181}$/.test(kid) || !pem) throw new Error("Catalog access signing is not configured.");
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Catalog access requires a P-256 signing key.");
    const now = Math.floor(Date.now() / 1000), exp = now + 600;
    const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: "procurement-catalog", sub: scope.userId, societyId, folder: scope.folder, iat: now, exp })).toString("base64url");
    const data = header + "." + payload;
    const signature = sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
    return { token: data + "." + signature, expiresAt: exp * 1000, baseUrl: scope.baseUrl };
  },
});
