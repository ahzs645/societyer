export type ListRow = {
  recordKey: string;
  kind: string;
  title: string;
  /** The buyer. */
  organization: string;
  /** Whom the notice is issued for, when the source names someone other than the buyer; otherwise "". */
  issuedFor: string;
  status: string;
  /** Sortable (YYYY-MM-DD or YYYY-MM-DDTHH:MM in the source zone) when readable; otherwise the source text. */
  date: string;
  dateText: string;
  /** The source's own reference number, "" when only a synthetic key exists. */
  reference: string;
  /** Files Zoer downloaded and published: previewable here. */
  documents: number;
  /** Files the source lists that weren't downloaded. */
  listedDocuments: number;
  /** Awards only ("" / null for opportunities). */
  supplier: string;
  value: number | null;
  currency: string;
  procurementType: string;
};
