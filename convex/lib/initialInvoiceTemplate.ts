import firstFormProfile from "../../shared/brandKits/firstform.json";
import { upsertTemplatePortable } from "../../shared/functions/invoices";
import { importInvoiceBrand } from "../../shared/invoiceBranding";
import { DEFAULT_INVOICE_TEMPLATE } from "../../shared/invoiceCommerce";
import type { PortableMutationCtx } from "../../shared/portable/ctx";

export async function installInitialInvoiceTemplate(ctx: PortableMutationCtx, societyId: string) {
  if (process.env.SOCIETYER_INITIAL_INVOICE_TEMPLATE !== "firstform") return;

  const brand = importInvoiceBrand(firstFormProfile, "https://projects.ahmadjalil.com/brandkit/?brand=firstform");
  await upsertTemplatePortable(ctx, {
    societyId,
    config: {
      ...DEFAULT_INVOICE_TEMPLATE,
      name: "First Form",
      accentColor: brand.primary,
      brand,
    },
    makeDefault: true,
  });
}
