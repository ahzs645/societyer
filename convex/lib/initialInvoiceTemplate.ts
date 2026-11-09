import firstFormProfile from "../../shared/brandKits/firstform.json";
import { upsertTemplatePortable } from "../../shared/functions/invoices";
import { importInvoiceBrand } from "../../shared/invoiceBranding";
import { DEFAULT_INVOICE_TEMPLATE } from "../../shared/invoiceCommerce";
import type { PortableMutationCtx } from "../../shared/portable/ctx";

export const INITIAL_INVOICE_TEMPLATES = ["firstform"] as const;
export type InitialInvoiceTemplate = (typeof INITIAL_INVOICE_TEMPLATES)[number];

/**
 * Install a named starter template as the workspace's default. `existingId`
 * refreshes a template installed earlier instead of adding a duplicate.
 */
export async function installInvoiceTemplate(ctx: PortableMutationCtx, societyId: string, template: InitialInvoiceTemplate, existingId?: string) {
  if (template !== "firstform") throw new Error(`Unknown invoice template "${template as string}".`);
  const brand = importInvoiceBrand(firstFormProfile, "https://projects.ahmadjalil.com/brandkit/?brand=firstform");
  return upsertTemplatePortable(ctx, {
    societyId,
    id: existingId,
    config: {
      ...DEFAULT_INVOICE_TEMPLATE,
      name: "First Form",
      accentColor: brand.primary,
      brand,
    },
    makeDefault: true,
  });
}

/**
 * Deployment-wide default for newly created workspaces. A shared deployment
 * leaves SOCIETYER_INITIAL_INVOICE_TEMPLATE unset and installs per workspace
 * through workspaceDefaults:installInvoiceTemplate instead.
 */
export async function installInitialInvoiceTemplate(ctx: PortableMutationCtx, societyId: string) {
  if (process.env.SOCIETYER_INITIAL_INVOICE_TEMPLATE !== "firstform") return;
  await installInvoiceTemplate(ctx, societyId, "firstform");
}
