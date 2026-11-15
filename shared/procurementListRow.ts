import { decodeHtmlEntities } from "./htmlEntities";

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
  /** Versioned source provenance, canonical parties and quality inputs, when published. */
  analyticsJson?: string;
};

const DRAWN = ["title", "organization", "issuedFor", "reference", "supplier", "procurementType"] as const;
/**
 * The row with HTML entities decoded in the fields the reader draws and
 * matches on. Catalogs Zoer published before it decoded source text can carry
 * them (`Caf&eacute;`), and rows enter the reader from Convex, the catalog
 * service and the demo snapshot, so each source passes its rows through here.
 */
export function readableListRow<Row extends ListRow>(row: Row): Row {
  if (!DRAWN.some((field) => typeof row[field] === "string" && row[field].includes("&"))) return row;
  const next = { ...row };
  for (const field of DRAWN) if (typeof row[field] === "string") next[field] = decodeHtmlEntities(row[field]);
  return next;
}
