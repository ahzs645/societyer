/** Receiving instructions saved by the society and copied onto each invoice. */
export const INVOICE_PAYMENT_METHOD_TYPES = {
  eft: "EFT / bank transfer", e_transfer: "E-transfer", cheque: "Cheque",
  cash: "Cash", card: "Card / payment link", other: "Other",
} as const;
export type InvoiceReceivingMethod = {
  id: string; name: string; type: keyof typeof INVOICE_PAYMENT_METHOD_TYPES; details: string;
};
export type InvoicePaymentSnapshot = { paymentMethods?: InvoiceReceivingMethod[]; paymentInstructions?: string };

export function cleanInvoicePaymentMethods(value: unknown): InvoiceReceivingMethod[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("Save up to 20 payment methods.");
  const ids = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !/^[\w-]{1,80}$/.test(raw.id) || ids.has(raw.id)) throw new Error("Each payment method needs a unique ID.");
    ids.add(raw.id);
    if (!Object.hasOwn(INVOICE_PAYMENT_METHOD_TYPES, raw.type)) throw new Error("Choose a supported payment method type.");
    if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 100) throw new Error("Give each payment method a name of up to 100 characters.");
    if (typeof raw.details !== "string" || !raw.details.trim() || raw.details.length > 2000) throw new Error("Enter payment details of up to 2,000 characters for each method.");
    return { id: raw.id, name: raw.name.trim(), type: raw.type, details: raw.details.trim() };
  });
}

export function selectInvoicePaymentMethods(methods: InvoiceReceivingMethod[], ids: string[]): InvoiceReceivingMethod[] {
  if (!Array.isArray(ids) || ids.length > 20 || new Set(ids).size !== ids.length) throw new Error("Choose each payment method only once.");
  return ids.map((id) => {
    const method = methods.find((item) => item.id === id);
    if (!method) throw new Error("A selected payment method is unavailable. Choose a saved method from this society.");
    return { ...method };
  });
}

export function invoicePaymentText(invoice: InvoicePaymentSnapshot, legacyInstructions?: string): string {
  return [invoice.paymentInstructions ?? legacyInstructions, ...(invoice.paymentMethods ?? []).map((method) => `${method.name}\n${method.details}`)].filter(Boolean).join("\n\n");
}

export function defaultInvoicePayments(settings: InvoicePaymentSnapshot & { defaultPaymentMethodIds?: string[] } | null): Required<InvoicePaymentSnapshot> {
  return {
    paymentMethods: selectInvoicePaymentMethods(settings?.paymentMethods ?? [], settings?.defaultPaymentMethodIds ?? []),
    // An empty snapshot deliberately prevents later settings edits appearing on saved invoices.
    paymentInstructions: settings?.paymentInstructions ?? "",
  };
}
