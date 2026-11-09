/** Only internal, unposted manual finalizations can return to an editable draft. */
export function invoiceDraftReopenBlocker(row: {
  status: string; lifecycle?: string; issuedAtISO?: string; sentAtISO?: string;
  externalDelivery?: unknown; clientResponse?: unknown; lastReminderAtISO?: string;
  journalEntryId?: string; reversalJournalEntryId?: string; ledgerRound?: number;
  payments?: readonly unknown[]; fxRevaluations?: readonly unknown[];
  seriesId?: string; source?: string; repairJobId?: string; subscriptionId?: string; duesBatch?: string;
  timeline?: readonly { kind: string }[];
}): string | null {
  if ((row.lifecycle ?? row.status) !== "issued" || !row.issuedAtISO) return "Only a finalized, unsent invoice can return to draft.";
  if (row.sentAtISO || row.externalDelivery || row.clientResponse || row.lastReminderAtISO) return "This invoice has delivery or client-response history. Use a credit or replacement instead.";
  if (row.payments?.length || row.fxRevaluations?.length) return "An invoice with settlement or currency-adjustment history cannot return to draft.";
  if (row.journalEntryId || row.reversalJournalEntryId || (row.ledgerRound ?? 1) > 1) return "An invoice with ledger history cannot return to draft.";
  if (row.seriesId || row.repairJobId || row.subscriptionId || row.duesBatch || (row.source && !["manual", "duplicate"].includes(row.source))) return "Only standalone manual invoices can return to draft.";
  if (row.timeline?.some(entry => !["created", "issued", "duplicated", "returned_to_draft"].includes(entry.kind))) return "Review this invoice's existing workflow history; use a replacement for corrections.";
  return null;
}
