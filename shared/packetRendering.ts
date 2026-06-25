/**
 * Grammar-aware rendering of document-packet prose (pure logic).
 *
 * Lets packet section bodies (shared/corporationDocumentPackets.ts) contain
 * {token} / {#if} / {#each} markup that binds against a RenderContext at
 * generation time — the YCN cell-formula CONCATENATE+IF idea, in TS. When no
 * context is supplied the text passes through unchanged, so existing token-free
 * packets render byte-identically.
 */

import { renderTemplate, type TemplateValues } from "./templateAssembly";

export type PacketSection = { heading: string; body: string[] };

/** Render a single line through the template engine, or return it unchanged. */
export function renderText(text: string, context?: TemplateValues): string {
  return context ? renderTemplate(text, context) : text;
}

/** Render every body line (and the heading) of each section. */
export function renderSections(
  sections: readonly PacketSection[],
  context?: TemplateValues,
): PacketSection[] {
  if (!context) return sections.map((s) => ({ heading: s.heading, body: [...s.body] }));
  return sections.map((section) => ({
    heading: renderText(section.heading, context),
    body: section.body.map((line) => renderText(line, context)),
  }));
}
