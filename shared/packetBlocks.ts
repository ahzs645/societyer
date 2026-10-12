/**
 * STRUCTURED PACKET BODY BLOCKS (pure types + helpers).
 *
 * A packet section body (shared/corporationDocumentPackets.ts) is a list of
 * items. Historically every item was a plain string of prose; a section may now
 * also carry structured blocks so the DOCX renderer
 * (shared/corporationPacketDocx.ts) can lay out a signable instrument the way a
 * lawyer's precedent does: WHEREAS recitals, "BE IT RESOLVED THAT:", numbered
 * clauses, real tables and an explicit adoption line.
 *
 * Plain strings stay valid everywhere (they render as unnumbered paragraphs),
 * so a catalog that has not migrated a packet keeps working unchanged.
 *
 * Every `text` / cell value is a template string rendered through the shared
 * template engine (shared/templateAssembly.ts), so {token}, {#if} and {#each}
 * markup binds against the packet render context.
 *
 * Every block may carry `when`: a context path; the block is rendered only when
 * that path is truthy ("!path" renders it only when the path is falsy). This
 * lets one packet include an optional recital or clause without string tricks.
 */

/** A table. Static `rows`, or one row per item of the array at `each`. */
export interface PacketTableBlock {
  kind: "table";
  /** Column headings. An empty array renders a table without a heading row. */
  columns: string[];
  /** Static rows; each cell is a template string. */
  rows?: string[][];
  /**
   * Context path to an array. One row is rendered per item; `cells` are
   * template strings where {.field} (or {this.field}) reads the current item.
   */
  each?: string;
  cells?: string[];
  /** Printed instead of an empty table when no row results. */
  emptyText?: string;
  /** Relative column widths (any positive numbers); defaults to equal widths. */
  widths?: number[];
  when?: string;
}

/** A signature table (two signers per row, name printed under the line). */
export interface PacketSignaturesBlock {
  kind: "signatures";
  signers: Array<{ name: string; capacity?: string; corpSign?: string | null }>;
  /** Optional line printed above the table, e.g. "Dated: June 25, 2026". */
  dateLine?: string;
  when?: string;
}

export type PacketBlock =
  /** Overrides the instrument subtitle (defaults to the packet templateName). */
  | { kind: "title"; text: string; when?: string }
  /** A sub-heading inside the document. */
  | { kind: "heading"; text: string; when?: string }
  /** Unnumbered prose. */
  | { kind: "paragraph"; text: string; when?: string }
  /** Small italic note (review prompts, restricted-access notices). */
  | { kind: "note"; text: string; when?: string }
  /** A recital. "WHEREAS" / "AND WHEREAS" is prefixed when missing. */
  | { kind: "recital"; text: string; when?: string }
  /**
   * The resolving words. Optional: the renderer inserts "BE IT RESOLVED THAT:"
   * before the first clause when no `resolved` block precedes it.
   */
  | { kind: "resolved"; text?: string; when?: string }
  /** A numbered operative clause. Numbers count only the clauses rendered. */
  | { kind: "clause"; text: string; number?: string; when?: string }
  /**
   * An explicit adoption line. When present it replaces the generated
   * "consented to in writing" clause in the execution block.
   */
  | { kind: "adoption"; text: string; when?: string }
  | PacketTableBlock
  | PacketSignaturesBlock
  /** Start a new page (e.g. between per-person consents). */
  | { kind: "pageBreak"; when?: string };

export type PacketBlockKind = PacketBlock["kind"];

/** One item of a section body: legacy prose string or a structured block. */
export type PacketBodyItem = string | PacketBlock;

/** A packet section whose body may mix prose strings and blocks. */
export interface PacketBlockSection {
  heading: string;
  body: readonly PacketBodyItem[];
}

const BLOCK_KINDS: ReadonlySet<string> = new Set<PacketBlockKind>([
  "title", "heading", "paragraph", "note", "recital", "resolved", "clause", "adoption", "table", "signatures", "pageBreak",
]);

export function isPacketBlock(item: unknown): item is PacketBlock {
  return typeof item === "object" && item !== null && BLOCK_KINDS.has(String((item as { kind?: unknown }).kind));
}

/** Plain text of a body item, for HTML previews, search and legacy consumers. */
export function packetBodyItemText(item: PacketBodyItem): string {
  if (typeof item === "string") return item;
  switch (item.kind) {
    case "table": {
      const head = item.columns.join(" | ");
      const rows = (item.rows ?? []).map((row) => row.join(" | "));
      return [head, ...rows].filter(Boolean).join("\n");
    }
    case "signatures":
      return item.signers.map((signer) => signer.name).join("\n");
    case "pageBreak":
      return "";
    case "resolved":
      return item.text ?? "BE IT RESOLVED THAT:";
    default:
      return item.text;
  }
}

/** True when any section uses structured blocks (not only prose strings). */
export function sectionsUseBlocks(sections: readonly PacketBlockSection[]): boolean {
  return sections.some((section) => section.body.some(isPacketBlock));
}
