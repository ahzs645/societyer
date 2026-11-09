import type { InvoiceIssuerSnapshot, InvoiceOrganization } from "./types";

/** Issued documents use the identity captured at finalization, including absent fields. */
export function invoiceDocumentOrganization(
  invoice: { issuerSnapshot?: InvoiceIssuerSnapshot; issuerLogoUrl?: string | null },
  current: InvoiceOrganization,
): InvoiceOrganization {
  if (!invoice.issuerSnapshot) return current;
  const snapshot = invoice.issuerSnapshot;
  return {
    ...current,
    name: snapshot.name,
    address: snapshot.address,
    email: snapshot.email,
    registrationNumber: snapshot.registrationNumber,
    logoUrl: snapshot.logoStorageId ? invoice.issuerLogoUrl ?? null : null,
  };
}
