/**
 * PACKET INSTRUMENT (pure logic).
 *
 * A packet may declare `instrument`: the signable resolution laid out the way
 * the lawyer's `Doc - *` sheets lay it out (title, subtitle, WHEREAS recitals,
 * "BE IT RESOLVED THAT:", numbered clauses with tables, then "Dated:", the
 * adoption clause and the signature blocks). This module renders that spec
 * against the packet's render context into a flat list of typed blocks.
 *
 * RENDERED BLOCK SHAPE (`context.instrument.blocks`, consumed by the DOCX
 * layer in shared/corporationPacketDocx.ts):
 *
 *   { kind: "title", text }          uppercase instrument title ("CONSENT DIRECTORS' RESOLUTION")
 *   { kind: "subtitle", text }       e.g. "Share Allotment and Issue"
 *   { kind: "heading", text }        heading inside the instrument or an annex
 *   { kind: "recital", text }        a WHEREAS recital (text starts with "WHEREAS")
 *   { kind: "resolved", text }       the "BE IT RESOLVED THAT:" line
 *   { kind: "clause", number, text } numbered operative clause; numbers count only the clauses present
 *   { kind: "table", columns, rows } columns: string[]; rows: string[][]; belongs to the preceding clause
 *   { kind: "list", items }          indented list (e.g. a director slate); items: string[]
 *   { kind: "paragraph", text }      plain paragraph
 *   { kind: "note", text }           bracketed preparation prompt; must be resolved, never signed as-is
 *   { kind: "dated", text }          "Dated: June 25, 2026"
 *   { kind: "adoption", text }       the adoption clause ("The undersigned, being …")
 *   { kind: "signatures", signers }  signers: SignerLine[] (individual, or corporate "By:" block)
 *   { kind: "pageBreak" }            start the following blocks on a new page (annexes)
 *
 * The execution part (dated / adoption / signatures) is appended by
 * `withExecution`; annex blocks (e.g. a resignation letter) follow it.
 * Framework-free.
 */

import { renderTemplate, resolvePath, type TemplateValues } from "./templateAssembly";
import type { SignerLine } from "./executionBlock";
import type { PacketBlock } from "./packetBlocks";

export type InstrumentBlock =
  | { kind: "title" | "subtitle" | "heading" | "recital" | "resolved" | "paragraph" | "note" | "dated" | "adoption"; text: string }
  | { kind: "clause"; number: number; text: string }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "list"; items: string[] }
  | { kind: "signatures"; signers: SignerLine[] }
  | { kind: "pageBreak" };

export interface InstrumentTableSpec {
  /** Path to an array in the context. */
  rows: string;
  /** Header and cell are templates; cells render against the row ({.field}). */
  columns: Array<{ header: string; cell: string }>;
}

export interface InstrumentListSpec {
  items: string;
  /** Template rendered against each item ({.field}). */
  item: string;
}

interface Conditional {
  /** Render only when this context path is truthy. */
  when?: string;
  /** Render only when this context path is falsy. */
  unless?: string;
}

export type InstrumentBlockSpec =
  | ({ kind: "title" | "subtitle" | "heading" | "recital" | "resolved" | "paragraph" | "note"; text: string } & Conditional)
  | ({ kind: "clause"; id?: string; text: string; table?: InstrumentTableSpec; list?: InstrumentListSpec } & Conditional)
  | ({ kind: "table" } & InstrumentTableSpec & Conditional)
  | ({ kind: "list" } & InstrumentListSpec & Conditional)
  | ({ kind: "signatures"; signers: string } & Conditional)
  | ({ kind: "pageBreak" } & Conditional)
  /** Render `blocks` once per item of the array at `items`, bound as {item.*}; items are separated by page breaks. */
  | ({ kind: "repeat"; items: string; blocks: InstrumentBlockSpec[] } & Conditional);

export interface InstrumentSpec {
  blocks: InstrumentBlockSpec[];
  /** Blocks placed after the execution page (e.g. a resignation letter). */
  annex?: InstrumentBlockSpec[];
}

export interface RenderedInstrument {
  blocks: InstrumentBlock[];
  annex: InstrumentBlock[];
  clauseCount: number;
  /** True when more than one numbered clause is present ("resolutions"). */
  resolutionsPlural: boolean;
}

function truthy(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function included(spec: Conditional, context: TemplateValues): boolean {
  if (spec.when && !truthy(resolvePath(context, spec.when))) return false;
  if (spec.unless && truthy(resolvePath(context, spec.unless))) return false;
  return true;
}

/** Collapse template whitespace left by empty conditionals. */
export function tidy(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ ([,.;:])/g, "$1")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .trim();
}

function renderLine(template: string, context: TemplateValues): string {
  return tidy(renderTemplate(template, context));
}

/** Render a template against one item, so {.field} and {#if .field} bind to it. */
function renderItem(template: string, item: unknown, context: TemplateValues): string {
  return renderLine(`{#each __item}${template}{/each}`, { ...context, __item: [item] });
}

function renderTable(spec: InstrumentTableSpec, context: TemplateValues): InstrumentBlock | null {
  const rows = resolvePath(context, spec.rows);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return {
    kind: "table",
    columns: spec.columns.map((column) => renderLine(column.header, context)),
    rows: rows.map((row) => spec.columns.map((column) => renderItem(column.cell, row, context))),
  };
}

function renderList(spec: InstrumentListSpec, context: TemplateValues): InstrumentBlock | null {
  const items = resolvePath(context, spec.items);
  if (!Array.isArray(items) || items.length === 0) return null;
  return {
    kind: "list",
    items: items.map((item) => renderItem(spec.item, item, context)).filter(Boolean),
  };
}

function renderBlocks(specs: readonly InstrumentBlockSpec[], context: TemplateValues): { blocks: InstrumentBlock[]; clauses: number } {
  const blocks: InstrumentBlock[] = [];
  let clause = 0;
  for (const spec of specs) {
    if (!included(spec, context)) continue;
    switch (spec.kind) {
      case "clause": {
        clause += 1;
        blocks.push({ kind: "clause", number: clause, text: renderLine(spec.text, context) });
        const table = spec.table ? renderTable(spec.table, context) : null;
        if (table) blocks.push(table);
        const list = spec.list ? renderList(spec.list, context) : null;
        if (list) blocks.push(list);
        break;
      }
      case "table": {
        const table = renderTable(spec, context);
        if (table) blocks.push(table);
        break;
      }
      case "list": {
        const list = renderList(spec, context);
        if (list) blocks.push(list);
        break;
      }
      case "signatures": {
        const signers = resolvePath(context, spec.signers);
        if (Array.isArray(signers) && signers.length) blocks.push({ kind: "signatures", signers: signers as SignerLine[] });
        break;
      }
      case "pageBreak":
        blocks.push({ kind: "pageBreak" });
        break;
      case "repeat": {
        const items = resolvePath(context, spec.items);
        if (!Array.isArray(items)) break;
        items.forEach((item, index) => {
          if (index > 0) blocks.push({ kind: "pageBreak" });
          blocks.push(...renderBlocks(spec.blocks, { ...context, item }).blocks);
        });
        break;
      }
      case "title": {
        const text = renderLine(spec.text, context).toUpperCase();
        if (text) blocks.push({ kind: "title", text });
        break;
      }
      default: {
        const text = renderLine(spec.text, context);
        if (text) blocks.push({ kind: spec.kind, text });
      }
    }
  }
  return { blocks, clauses: clause };
}

/**
 * Clause numbers by id, counting only the clauses whose conditions hold, so a
 * cross-reference ("cancelled by resolution {clause.cancel}") stays correct.
 */
export function instrumentClauseNumbers(spec: InstrumentSpec, context: TemplateValues): Record<string, number> {
  const numbers: Record<string, number> = {};
  let n = 0;
  for (const block of spec.blocks) {
    if (block.kind !== "clause" || !included(block, context)) continue;
    n += 1;
    if (block.id) numbers[block.id] = n;
  }
  return numbers;
}

export function renderInstrument(spec: InstrumentSpec, context: TemplateValues): RenderedInstrument {
  const clause = instrumentClauseNumbers(spec, context);
  const bound = { ...context, clause };
  const main = renderBlocks(spec.blocks, bound);
  const annex = renderBlocks(spec.annex ?? [], bound);
  return { blocks: main.blocks, annex: annex.blocks, clauseCount: main.clauses, resolutionsPlural: main.clauses > 1 };
}

/** Append the execution page (dated, adoption clause, signatures) and any annex. */
export function withExecution(
  rendered: RenderedInstrument,
  execution: { adoptionClause: string; dateLong?: string; signers: SignerLine[]; datedLabel?: string } | undefined,
): InstrumentBlock[] {
  if (!execution) return [...rendered.blocks, ...(rendered.annex.length ? [{ kind: "pageBreak" } as const, ...rendered.annex] : [])];
  return [
    ...rendered.blocks,
    ...(execution.dateLong ? [{ kind: "dated", text: `${execution.datedLabel ?? "Dated"}: ${execution.dateLong}` } as const] : []),
    { kind: "adoption", text: execution.adoptionClause },
    { kind: "signatures", signers: execution.signers },
    ...(rendered.annex.length ? [{ kind: "pageBreak" } as const, ...rendered.annex] : []),
  ];
}

/** Plain-text lines for a block list (fallback layouts, previews and tests). */
export function instrumentPlainLines(blocks: readonly InstrumentBlock[]): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "clause":
        lines.push(`${block.number}. ${block.text}`);
        break;
      case "table":
        lines.push(block.columns.join(" | "));
        for (const row of block.rows) lines.push(row.join(" | "));
        break;
      case "list":
        for (const item of block.items) lines.push(`    ${item}`);
        break;
      case "signatures":
        for (const signer of block.signers) {
          if (signer.corpSign) lines.push(signer.corpSign, "By: ____________________________", `    ${signer.name}${signer.capacity ? `, ${signer.capacity}` : ""}`);
          else lines.push("____________________________", `${signer.name}${signer.capacity ? `, ${signer.capacity}` : ""}`);
        }
        break;
      case "pageBreak":
        lines.push("");
        break;
      default:
        lines.push(block.text);
    }
  }
  return lines;
}

/**
 * Template lines for the catalog view of an instrument (legal template HTML and
 * the section fallback): one line per block spec, with markup left in place.
 */
export function instrumentTemplateLines(spec: InstrumentSpec): string[] {
  const line = (block: InstrumentBlockSpec): string | null => {
    switch (block.kind) {
      case "clause": {
        const parts = [`# ${block.text}`];
        if (block.table) parts.push(`[Table: ${block.table.columns.map((c) => c.header).join(" | ")}]`);
        if (block.list) parts.push(`[List: ${block.list.item}]`);
        return parts.join(" ");
      }
      case "table":
        return `[Table: ${block.columns.map((c) => c.header).join(" | ")}]`;
      case "list":
        return `[List: ${block.item}]`;
      case "signatures":
        return "[Signature blocks]";
      case "pageBreak":
        return null;
      case "repeat":
        return block.blocks.map(line).filter(Boolean).join(" / ");
      default:
        return block.text;
    }
  };
  return [...spec.blocks, ...(spec.annex ?? [])].map(line).filter((value): value is string => Boolean(value));
}

// ---------------------------------------------------------------------------
// Bridge to the section body blocks the DOCX layer renders (shared/packetBlocks.ts).
// ---------------------------------------------------------------------------

function condition(spec: { when?: string; unless?: string }): { when?: string } {
  if (spec.when && spec.unless) throw new Error("A packet block can carry either `when` or `unless`, not both.");
  return spec.when ? { when: spec.when } : spec.unless ? { when: `!${spec.unless}` } : {};
}

/**
 * Templated section body blocks for an instrument spec, in the shape the DOCX
 * renderer consumes. The renderer generates the possessive instrument title
 * itself, so a spec `subtitle` becomes the `title` (subtitle) block; a spec
 * title is kept only when the spec has no subtitle.
 */
export function instrumentPacketBlocks(spec: InstrumentSpec): PacketBlock[] {
  const hasSubtitle = spec.blocks.some((block) => block.kind === "subtitle");
  const out: PacketBlock[] = [];
  const convert = (block: InstrumentBlockSpec) => {
    const when = condition(block);
    switch (block.kind) {
      case "title":
        if (!hasSubtitle) out.push({ kind: "title", text: block.text, ...when });
        return;
      case "subtitle":
        out.push({ kind: "title", text: block.text, ...when });
        return;
      case "clause":
        out.push({ kind: "clause", text: block.text, ...when });
        if (block.table) out.push({ kind: "table", columns: block.table.columns.map((c) => c.header), each: block.table.rows, cells: block.table.columns.map((c) => c.cell), ...when });
        if (block.list) out.push({ kind: "table", columns: [], each: block.list.items, cells: [block.list.item], ...when });
        return;
      case "table":
        out.push({ kind: "table", columns: block.columns.map((c) => c.header), each: block.rows, cells: block.columns.map((c) => c.cell), ...when });
        return;
      case "list":
        out.push({ kind: "table", columns: [], each: block.items, cells: [block.item], ...when });
        return;
      case "signatures":
        return; // signers are resolved at generation (renderedPacketBlocks)
      case "pageBreak":
        out.push({ kind: "pageBreak", ...when });
        return;
      case "repeat": {
        const text = block.blocks
          .flatMap((inner) => ("text" in inner ? [inner.text.replace(/\{item\./g, "{.")] : []))
          .join("\n");
        out.push({ kind: "table", columns: [], each: block.items, cells: [text], ...when });
        return;
      }
      default:
        out.push({ kind: block.kind, text: block.text, ...when });
    }
  };
  for (const block of spec.blocks) convert(block);
  if (spec.annex?.length) {
    out.push({ kind: "pageBreak" });
    for (const block of spec.annex) convert(block);
  }
  return out;
}

const escapeBraces = (text: string) => text.replace(/\{/g, "{{").replace(/\}/g, "}}");

/**
 * A rendered instrument as static section body blocks (no template markup
 * left; literal braces escaped), for the DOCX renderer at generation time.
 * The resolution's own execution page comes from `context.execution`, so it is
 * not repeated here; annex signatures (e.g. a resignation letter) are kept.
 */
export function renderedPacketBlocks(rendered: Pick<RenderedInstrument, "blocks" | "annex">): PacketBlock[] {
  const hasSubtitle = rendered.blocks.some((block) => block.kind === "subtitle");
  const convert = (block: InstrumentBlock): PacketBlock[] => {
    switch (block.kind) {
      case "title":
        return hasSubtitle ? [] : [{ kind: "title", text: escapeBraces(block.text) }];
      case "subtitle":
        return [{ kind: "title", text: escapeBraces(block.text) }];
      case "clause":
        return [{ kind: "clause", text: escapeBraces(block.text) }];
      case "table":
        return [{ kind: "table", columns: block.columns.map(escapeBraces), rows: block.rows.map((row) => row.map(escapeBraces)) }];
      case "list":
        return [{ kind: "table", columns: [], rows: block.items.map((item) => [escapeBraces(item)]) }];
      case "signatures":
        return [{ kind: "signatures", signers: block.signers.map((s) => ({ name: s.name, ...(s.capacity ? { capacity: s.capacity } : {}), ...(s.corpSign ? { corpSign: s.corpSign } : {}) })) }];
      case "pageBreak":
        return [{ kind: "pageBreak" }];
      case "dated":
        return [{ kind: "paragraph", text: escapeBraces(block.text) }];
      case "adoption":
        return [{ kind: "adoption", text: escapeBraces(block.text) }];
      default:
        return [{ kind: block.kind, text: escapeBraces(block.text) }];
    }
  };
  return [
    ...rendered.blocks.flatMap(convert),
    ...(rendered.annex.length ? [{ kind: "pageBreak" } as PacketBlock, ...rendered.annex.flatMap(convert)] : []),
  ];
}
