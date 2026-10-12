/**
 * Grammar-aware rendering of document-packet prose (pure logic).
 *
 * Lets packet section bodies (shared/corporationDocumentPackets.ts) contain
 * {token} / {#if} / {#each} markup that binds against a RenderContext at
 * generation time — the YCN cell-formula CONCATENATE+IF idea, in TS. When no
 * context is supplied the text passes through unchanged, so existing token-free
 * packets render byte-identically.
 *
 * Section bodies may also carry structured blocks (shared/packetBlocks.ts);
 * this plain-text view flattens them to lines (tables as "a | b" rows).
 */

import { renderTemplate, resolvePath, type TemplateValues } from "./templateAssembly";
import { isPacketBlock, packetBodyItemText, type PacketBlock, type PacketBodyItem } from "./packetBlocks";

export type PacketSection = { heading: string; body: string[] };
export type PacketSectionInput = { heading: string; body: readonly PacketBodyItem[] };

/** Render a single line through the template engine, or return it unchanged. */
export function renderText(text: string, context?: TemplateValues): string {
  return context ? renderTemplate(text, context) : text;
}

function allowed(block: PacketBlock, context: TemplateValues): boolean {
  if (!block.when) return true;
  const negate = block.when.startsWith("!");
  const value = resolvePath(context, negate ? block.when.slice(1) : block.when);
  const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
  return negate ? !truthy : truthy;
}

/** Plain-text lines of one structured block rendered against the context. */
function blockLines(block: PacketBlock, context: TemplateValues): string[] {
  if (!allowed(block, context)) return [];
  if (block.kind === "table") {
    const head = block.columns.length ? [block.columns.map((c) => renderText(c, context)).join(" | ")] : [];
    if (block.each) {
      const items = resolvePath(context, block.each);
      const rows = Array.isArray(items)
        ? items.map((item) => (block.cells ?? []).map((cell) => renderTemplate(`{#each __row}${cell}{/each}`, { ...context, __row: [item] })).join(" | "))
        : [];
      return rows.length ? [...head, ...rows] : block.emptyText ? [renderText(block.emptyText, context)] : [];
    }
    return [...head, ...(block.rows ?? []).map((row) => row.map((cell) => renderText(cell, context)).join(" | "))];
  }
  if (block.kind === "pageBreak") return [];
  const text = packetBodyItemText(block);
  return text ? [renderText(text, context)] : [];
}

/** Render every body line (and the heading) of each section. */
export function renderSections(
  sections: readonly PacketSectionInput[],
  context?: TemplateValues,
): PacketSection[] {
  if (!context) return sections.map((s) => ({ heading: s.heading, body: s.body.map((item) => packetBodyItemText(item)) }));
  return sections.map((section) => ({
    heading: renderText(section.heading, context),
    body: section.body.flatMap((item) => (isPacketBlock(item) ? blockLines(item, context) : [renderText(item, context)])),
  }));
}
