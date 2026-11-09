/** Draft identity is a document state, independent of optional template stamps. */
export function invoiceDocumentStatus(
  invoice: { documentKind?: string; lifecycle?: string; status?: string },
  stamp: { visible: boolean; text?: string },
): { draft: boolean; text?: string } {
  if ((invoice.documentKind ?? "invoice") !== "invoice") return { draft: false };
  const draft = (invoice.lifecycle ?? invoice.status) === "draft";
  if (draft) return { draft: true, text: "DRAFT" };
  if (!stamp.visible || !invoice.status) return { draft: false };
  const customText = stamp.text?.trim();
  return { draft: false, text: customText && customText.toUpperCase() !== "DRAFT" ? customText : invoice.status.replaceAll("_", " ").toUpperCase() };
}
