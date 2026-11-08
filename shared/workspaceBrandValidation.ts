import { brandkitViewBox, normalizeBrandkitLogo } from "./brandkitLogo";
import { cleanInvoiceBrand, type InvoiceBrand } from "./invoiceBranding";

export const MAX_WORKSPACE_BRAND_BYTES = 250_000;

function assertWorkspaceBrandSize(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || new TextEncoder().encode(serialized).length > MAX_WORKSPACE_BRAND_BYTES) {
    throw new Error("The workspace Brandkit must be 250 KB or smaller. Export a smaller consumer profile.");
  }
}

/** Validate new workspace snapshots without rewriting existing invoice designs. */
export function cleanWorkspaceBrand(input: InvoiceBrand): InvoiceBrand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Choose a valid Brandkit profile.");
  }
  assertWorkspaceBrandSize(input);
  const brand = cleanInvoiceBrand(input);
  // The legacy document adapter preserves old geometry for issued documents.
  // A new interface snapshot also gets the strict passive-vector parser, which
  // rejects malformed XML, external assets and active SVG in either format.
  if (!brand.consumerProfileSchema) {
    brand.logoSvg = normalizeBrandkitLogo(
      brand.logoSvg,
      brandkitViewBox([0, 0, brand.logoWidth, brand.logoHeight]),
    );
  }
  assertWorkspaceBrandSize(brand);
  // Optional nested values must be absent, not undefined, in stored Convex data.
  return JSON.parse(JSON.stringify(brand)) as InvoiceBrand;
}
