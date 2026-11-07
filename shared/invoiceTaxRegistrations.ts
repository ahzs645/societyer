/** Seller registrations are separate from an item's tax treatment. New tax
 * regimes can supply another taxId without changing the invoice snapshot. */
export type IssuerTaxRegistration = {
  taxId: string;
  label: string;
  number: string;
  jurisdiction?: string;
};

export type InvoiceSupplierTaxSnapshot = {
  charityRegistrationStatus: "registered" | "not_registered" | "unknown" | "conflict";
  charityRegistrationRevisionId?: string;
  organizationFactsKey: string;
};

export type InvoiceIssuerTaxSnapshot = {
  capturedAtISO: string;
  effectiveDate: string;
  registrations: IssuerTaxRegistration[];
  supplierFacts?: InvoiceSupplierTaxSnapshot;
};

type Identifier = {
  kind?: string;
  number?: string;
  status?: string;
  jurisdiction?: string;
  registeredAt?: string;
};

type TaxLine = { taxAssessment?: { components?: Array<{ taxId: string; collection: string; treatment?: string }> } };

export function normalizeGstRegistration(value: string): string | undefined {
  const number = value.toUpperCase().replace(/[\s-]/g, "");
  return /^\d{9}RT\d{4}$/.test(number) ? number : undefined;
}

export function normalizeBcPstRegistration(value: string): string | undefined {
  const number = value.toUpperCase().replace(/[\s-]/g, "");
  return /^PST\d{8}$/.test(number) ? `PST-${number.slice(3, 7)}-${number.slice(7)}` : undefined;
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Only active, correctly formatted and unambiguous registrations are printed.
 * Provided effective dates must be valid and no later than the invoice date;
 * absent dates rely on the user's active-status declaration for compatibility.
 * A BN alone is not a GST/HST account. */
export function selectIssuerTaxRegistrations(identifiers: Identifier[], effectiveDate: string): IssuerTaxRegistration[] {
  const candidates = new Map<string, Map<string, IssuerTaxRegistration>>();
  for (const identifier of identifiers) {
    if (identifier.status !== "active") continue;
    if (identifier.registeredAt && (!validDate(identifier.registeredAt) || identifier.registeredAt > effectiveDate)) continue;
    let registration: IssuerTaxRegistration | undefined;
    if (identifier.kind === "gst" || identifier.kind === "business_number") {
      const number = normalizeGstRegistration(identifier.number ?? "");
      if (number) registration = { taxId: "CA-GST", label: "GST/HST", number, jurisdiction: "CA" };
    } else if (identifier.kind === "pst" && (!identifier.jurisdiction || ["CA-BC", "british_columbia"].includes(identifier.jurisdiction))) {
      const number = normalizeBcPstRegistration(identifier.number ?? "");
      if (number) registration = { taxId: "CA-BC-PST", label: "BC PST", number, jurisdiction: "CA-BC" };
    }
    if (!registration) continue;
    const byNumber = candidates.get(registration.taxId) ?? new Map<string, IssuerTaxRegistration>();
    byNumber.set(registration.number, registration);
    candidates.set(registration.taxId, byNumber);
  }
  return [...candidates.values()].flatMap((byNumber) => byNumber.size === 1 ? [...byNumber.values()] : []);
}

export function guidedTaxIdsToCollect(lines: TaxLine[]): string[] {
  return [...new Set(lines.flatMap(line => (line.taxAssessment?.components ?? []).filter(component => component.collection === "collect").map(component => component.taxId)))];
}

/** Validate before posting any ledger entries, including portable batch sends. */
export function captureIssuerTaxRegistrations(identifiers: Identifier[], lines: TaxLine[], effectiveDate: string, capturedAtISO: string, supplierFacts?: InvoiceSupplierTaxSnapshot): InvoiceIssuerTaxSnapshot {
  const registrations = selectIssuerTaxRegistrations(identifiers, effectiveDate);
  // Check each eligible identifier independently: conflicting branch numbers
  // must not turn a registered seller into an apparently unregistered one.
  const registeredTaxIds = new Set(identifiers.flatMap(identifier => selectIssuerTaxRegistrations([identifier], effectiveDate).map(registration => registration.taxId)));
  for (const component of lines.flatMap(line => line.taxAssessment?.components ?? [])) {
    if (component.treatment === "standard" && component.collection === "do_not_collect" && registeredTaxIds.has(component.taxId)) {
      const label = component.taxId === "CA-GST" ? "GST/HST" : "BC PST";
      throw new Error(`The guided ${label} decision says not to collect on a standard taxable item, but the organization has an active ${label} registration for this date. Review the registration and tax guidance before issuing it.`);
    }
  }
  for (const taxId of guidedTaxIdsToCollect(lines)) {
    if (!["CA-GST", "CA-BC-PST"].includes(taxId)) continue;
    if (!registrations.some(registration => registration.taxId === taxId)) {
      const label = taxId === "CA-GST" ? "GST/HST" : "BC PST";
      throw new Error(`This invoice collects ${label}. Save one active ${label} registration effective on ${effectiveDate} in Organization → Identifiers. Resolve missing, invalid or conflicting numbers before issuing it.`);
    }
  }
  return { capturedAtISO, effectiveDate, registrations, ...(supplierFacts ? { supplierFacts } : {}) };
}

/** Drafts use current registrations; issued invoices use only their recorded
 * snapshot. Legacy issued records have no historic snapshot, so never borrow
 * today's numbers and present them as the original issuer details. */
export function invoiceIssuerTaxRegistrations(
  invoice: { issuerTaxRegistrationsSnapshot?: InvoiceIssuerTaxSnapshot; status?: string; lifecycle?: string; sentAtISO?: string; documentKind?: string },
  organization: { taxRegistrations?: IssuerTaxRegistration[]; gstNumber?: string; pstNumber?: string },
): IssuerTaxRegistration[] {
  if (invoice.issuerTaxRegistrationsSnapshot) return invoice.issuerTaxRegistrationsSnapshot.registrations;
  const isInvoice = !invoice.documentKind || ["invoice", "receipt"].includes(invoice.documentKind);
  const issued = invoice.sentAtISO || (invoice.lifecycle && invoice.lifecycle !== "draft") || (invoice.status && invoice.status !== "draft");
  if (isInvoice && issued) return [];
  if (organization.taxRegistrations) return organization.taxRegistrations;
  return [
    ...(organization.gstNumber ? [{ taxId: "CA-GST", label: "GST/HST", number: organization.gstNumber }] : []),
    ...(organization.pstNumber ? [{ taxId: "CA-BC-PST", label: "BC PST", number: organization.pstNumber }] : []),
  ];
}

export function registrationDisplayLines(registrations: IssuerTaxRegistration[]): string[] {
  return registrations.map(registration => `${registration.label} registration no. ${registration.number}`);
}
