import type { CORPORATION_DOCUMENT_PACKETS } from "./corporationDocumentPackets";
import { renderText } from "./packetRendering";
import { resolvePath, renderTemplate, type TemplateValues } from "./templateAssembly";
import { resolvingBodyFor, type ExecutionBlockResult, type SignerLine } from "./executionBlock";
import { isPacketBlock, type PacketBlock, type PacketBlockSection, type PacketBodyItem, type PacketTableBlock } from "./packetBlocks";
import { isReportPacketKey } from "./corporationReportPackets";
import type { MinuteBookReport } from "./minuteBookReports";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Letter page, one-inch margins: 12240 - 2 × 1440 twips of usable width. */
const CONTENT_WIDTH = 9360;
const SIGNATURE_RULE = "____________________________";

type CorporationDocumentPacket = (typeof CORPORATION_DOCUMENT_PACKETS)[number];

/**
 * The packet shape this renderer reads. Section bodies may mix legacy prose
 * strings and structured blocks (shared/packetBlocks.ts).
 */
type RenderablePacket = Omit<CorporationDocumentPacket, "sections"> & { sections: readonly PacketBlockSection[] };

/**
 * Generated DOCX for a catalog packet.
 *
 * - An executable packet (signature required, not preparation-only) renders as
 *   a signable instrument: document ID, company name, possessive title,
 *   subtitle, WHEREAS recitals, "BE IT RESOLVED THAT:", numbered clauses with
 *   real tables, "Dated:", the adoption clause and a two-column signature table
 *   kept together with the date.
 * - A preparation-only worksheet keeps its preparation banner and never gets an
 *   execution page; other non-signature packets render as plain documents.
 * - A report packet (shared/corporationReportPackets.ts) prints the report the
 *   caller built from the registers (`context.report`).
 *
 * The review checklist (summary, deliverable, terms, data lists, signers) is a
 * separate "Review memo" section that starts on a new page after the document,
 * so it is never part of the signed copy.
 *
 * Optional context: when provided, packet prose renders through the template
 * engine (shared/packetRendering.ts) so {token}/{#if}/{#each} markup binds.
 */
export function corporationPacketDocxBytes(packet: CorporationDocumentPacket | RenderablePacket, context?: TemplateValues) {
  const document = corporationPacketDocument(packet as RenderablePacket, context);
  return buildElementDocxPackage([...document.body, { t: "section" }, ...document.memo]);
}

export function corporationPacketDocxDataUrl(packet: CorporationDocumentPacket | RenderablePacket, context?: TemplateValues) {
  const bytes = corporationPacketDocxBytes(packet, context);
  return `data:${DOCX_MIME_TYPE};base64,${base64FromBytes(bytes)}`;
}

/** The document alone (no review memo), e.g. for an execution copy. */
export function corporationPacketInstrumentDocxBytes(packet: CorporationDocumentPacket | RenderablePacket, context?: TemplateValues) {
  return buildElementDocxPackage(corporationPacketDocument(packet as RenderablePacket, context).body);
}

/** The review memo alone, as its own document. */
export function corporationPacketReviewMemoDocxBytes(packet: CorporationDocumentPacket | RenderablePacket, context?: TemplateValues) {
  return buildElementDocxPackage(corporationPacketDocument(packet as RenderablePacket, context).memo);
}

export interface PacketFileNameOptions {
  /** Entity short name to prefix (YCN ENT_ID); omitted → packageName slug only. */
  shortName?: string | null;
  /** Effective date (any parseable date); rendered YYYY-MM-DD, else "NODATE". */
  effectiveDate?: string | null;
  /** Registry (incorporation) number; preferred over the short name in document IDs. */
  registryNumber?: string | null;
  /** Per-day sequence for this packet (1-based), appended as -01, -02, … */
  sequence?: number | null;
}

/**
 * Deterministic file name. With a shortName, mirrors YCN's
 * `ENT-DOCTYPE-YYYY-MM-DD.docx` (NODATE fallback); without, the legacy
 * packageName slug. A second or later document of the same type on the same
 * day gets its sequence suffix so file names do not collide.
 */
export function corporationPacketDocxFileName(
  packet: CorporationDocumentPacket,
  options: PacketFileNameOptions = {},
) {
  if (!options.shortName) {
    return `${slugifyForFile(packet.packageName)}.docx`;
  }
  const date = packetFileDatePart(options.effectiveDate);
  const sequence = options.sequence && options.sequence > 1 ? `-${sequencePart(options.sequence)}` : "";
  return `${slugifyForFile(options.shortName)}-${slugifyForFile(packet.key)}-${date}${sequence}.docx`;
}

/**
 * The deterministic document id used for the optional doc-ID header line:
 * `{registry number | short name}-{packet key}-{YYYY-MM-DD}[-{NN}]`, e.g.
 * `BC1234567-share-transfer-2026-10-12-02`. The registry number keeps two
 * entities with the same short name apart; the per-day sequence keeps two
 * documents of the same type on the same day apart.
 */
export function corporationPacketDocumentId(
  packet: CorporationDocumentPacket,
  options: PacketFileNameOptions = {},
) {
  const registry = registryIdPart(options.registryNumber);
  const base = registry || (options.shortName ? slugifyForFile(options.shortName) : slugifyForFile(packet.packageName));
  const sequence = options.sequence && options.sequence > 0 ? `-${sequencePart(options.sequence)}` : "";
  return `${base}-${slugifyForFile(packet.key)}-${packetFileDatePart(options.effectiveDate)}${sequence}`;
}

/**
 * The next per-day sequence for a packet: one more than the number of
 * documents already generated from the same packet for the same date.
 * `existing` are generatedLegalDocuments rows of the same organization.
 */
export function nextPacketDocumentSequence(
  existing: ReadonlyArray<{ effectiveDate?: string | null; createdAtISO?: string | null; sourceExternalIds?: readonly string[] | null }>,
  packetKey: string,
  effectiveDate?: string | null,
): number {
  const date = packetFileDatePart(effectiveDate);
  const marker = `societyer:corporation-packet-run:${packetKey}`;
  return existing.filter((row) =>
    (row.sourceExternalIds ?? []).includes(marker) &&
    packetFileDatePart(row.effectiveDate ?? row.createdAtISO) === date,
  ).length + 1;
}

function registryIdPart(value?: string | null): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function sequencePart(sequence: number): string {
  return String(Math.max(1, Math.floor(sequence))).padStart(2, "0");
}

function packetFileDatePart(effectiveDate?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(effectiveDate ?? "").trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "NODATE";
}

export function corporationPacketDocxMimeType() {
  return DOCX_MIME_TYPE;
}

/**
 * Generic single-document DOCX from a block list (title/heading/paragraph/
 * listItem) — used for companion documents like the per-subscriber Subscription
 * for Shares annex, which are not packet-shaped.
 */
export function documentDocxBytes(title: string, blocks: Array<{ kind: string; text: string }>) {
  return buildDocxPackage(title, blocks);
}

export function documentDocxDataUrl(title: string, blocks: Array<{ kind: string; text: string }>) {
  return `data:${DOCX_MIME_TYPE};base64,${base64FromBytes(documentDocxBytes(title, blocks))}`;
}

// ---------------------------------------------------------------------------
// Wording helpers (exported for tests and other renderers)
// ---------------------------------------------------------------------------

export interface ConsentClauseInput {
  /** Resolving-body noun from resolvingBodyFor: director | shareholder | voting shareholder | member | officer. */
  noun: string;
  /** Number of signatories (1 → "the sole …"). */
  count: number;
  shortName: string;
  legislation?: string;
  /** Long effective date, e.g. "June 25, 2026". */
  dateLong?: string;
  resolutionsPlural: boolean;
}

const BODY_PHRASES: Record<string, { one: string; many: string }> = {
  director: { one: "director", many: "directors" },
  shareholder: { one: "shareholder", many: "shareholders" },
  "voting shareholder": { one: "voting shareholder", many: "voting shareholders" },
  member: { one: "voting member", many: "voting members" },
};

/**
 * The adoption clause for a written consent resolution:
 * "The foregoing resolutions are consented to in writing by all the directors
 * of the Company, effective June 25, 2026, pursuant to the Business
 * Corporations Act." Wording follows the resolving body (directors,
 * shareholders, voting shareholders, voting members). Returns undefined for a
 * body that does not pass written resolutions (e.g. an officer).
 */
export function consentAdoptionClause(input: ConsentClauseInput): string | undefined {
  const phrase = BODY_PHRASES[input.noun];
  if (!phrase || !input.shortName.trim()) return undefined;
  const sole = input.count === 1;
  const subject = input.resolutionsPlural ? "The foregoing resolutions are" : "The foregoing resolution is";
  const body = sole ? `the sole ${phrase.one}` : `all the ${phrase.many}`;
  const effective = input.dateLong ? `, effective ${input.dateLong}` : "";
  const act = input.legislation ? `, pursuant to the ${input.legislation}` : "";
  return `${subject} consented to in writing by ${body} of ${input.shortName}${effective}${act}.`;
}

/**
 * Possessive instrument title chosen by the resolving body and count:
 * "CONSENT DIRECTOR'S RESOLUTION", "CONSENT DIRECTORS' RESOLUTION",
 * "CONSENT SHAREHOLDERS' RESOLUTION", "CONSENT MEMBERS' RESOLUTION".
 * Other bodies fall back to the packet's template name.
 */
export function instrumentTitle(noun: string, count: number | undefined, fallback: string): string {
  const base = noun === "voting shareholder" ? "shareholder" : noun;
  if (!["director", "shareholder", "member"].includes(base)) return fallback.toUpperCase();
  const possessive = count === 1 ? `${base}'s` : `${base}s'`;
  return `CONSENT ${possessive.toUpperCase()} RESOLUTION`;
}

/**
 * Signatories from an execution block: the structured `signers` when the
 * caller supplies them, otherwise parsed back from the printed signature
 * stack of shared/executionBlock.ts (blank spacer, then rule + name, or
 * organization + "By:" rule + authorized individual).
 */
export function executionSigners(execution?: (ExecutionBlockResult & { signers?: SignerLine[] }) | null): SignerLine[] {
  if (!execution) return [];
  if (Array.isArray(execution.signers)) return execution.signers;
  const groups: string[][] = [];
  let current: string[] | null = null;
  for (const line of execution.lines ?? []) {
    if (/^(Dated|Daté le):/.test(line)) continue;
    if (line === "") {
      current = [];
      groups.push(current);
      continue;
    }
    if (!current) {
      current = [];
      groups.push(current);
    }
    current.push(line);
  }
  return groups.filter((group) => group.length).map((group) => {
    const byIndex = group.findIndex((line) => line.startsWith("By:"));
    if (byIndex > 0) {
      return { corpSign: group[0], name: (group[byIndex + 1] ?? "").trim() };
    }
    const nameLine = group.find((line) => !/^_{4,}/.test(line.trim())) ?? "";
    return { name: nameLine.trim() };
  });
}

function executionDateLine(execution?: ExecutionBlockResult | null): string | undefined {
  return (execution?.lines ?? []).find((line) => /^(Dated|Daté le):/.test(line));
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

type ParagraphStyle = "Title" | "Heading1" | "Heading2" | "Subtitle" | "Normal" | "Note" | "Banner" | "DocId";

interface ParagraphElement {
  t: "p";
  text: string;
  style?: ParagraphStyle;
  align?: "left" | "center" | "right" | "both";
  bold?: boolean;
  italic?: boolean;
  keepNext?: boolean;
  indentLeft?: number;
  hanging?: number;
}

interface TableElement {
  t: "table";
  header: string[] | null;
  rows: string[][];
  widths?: number[];
  borders: boolean;
  /** Keep every row with the next one (signature blocks never orphan). */
  keepTogether?: boolean;
  /** A heading row repeated on every page the table spans. */
  repeatedCaption?: string;
}

type DocElement = ParagraphElement | TableElement | { t: "pageBreak" } | { t: "section" };

interface PacketDocument {
  body: DocElement[];
  memo: DocElement[];
}

interface RenderState {
  context?: TemplateValues;
  /** Instrument mode inserts "BE IT RESOLVED THAT:" before the first clause. */
  instrument: boolean;
  french: boolean;
  resolvedEmitted: boolean;
  clauseCount: number;
  recitalCount: number;
  subtitle?: string;
  adoption: string[];
}

function corporationPacketDocument(packet: RenderablePacket, context?: TemplateValues): PacketDocument {
  const execution = (context as { execution?: ExecutionBlockResult } | undefined)?.execution;
  const documentId = (context as { documentId?: string } | undefined)?.documentId;
  const report = (context as { report?: MinuteBookReport } | undefined)?.report;
  const header: DocElement[] = documentId ? [{ t: "p", style: "DocId", text: `Document ID: ${documentId}` }] : [];

  let body: DocElement[];
  let warnings: string[] = [];
  if (isReportPacketKey(packet.key)) {
    body = [...header, ...reportElements(packet, context, report)];
    warnings = report?.warnings ?? [];
  } else if (!packet.preparationOnly && packet.signatureRequired) {
    body = [...header, ...instrumentElements(packet, context, execution)];
  } else {
    body = [...header, ...worksheetElements(packet, context)];
  }
  return { body, memo: reviewMemoElements(packet, context, warnings) };
}

function newState(context: TemplateValues | undefined, instrument: boolean, french: boolean): RenderState {
  return { context, instrument, french, resolvedEmitted: false, clauseCount: 0, recitalCount: 0, adoption: [] };
}

function orgField(context: TemplateValues | undefined, field: string): string {
  const value = context ? resolvePath(context, `org.${field}`) : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function instrumentElements(packet: RenderablePacket, context: TemplateValues | undefined, execution?: ExecutionBlockResult) {
  const french = Boolean(execution?.adoptionClause && /^Les? soussigné/.test(execution.adoptionClause)) || (context as { locale?: string } | undefined)?.locale === "fr";
  const state = newState(context, true, french);
  const sections = renderSectionsToElements(packet.sections, state);
  const body = resolvingBodyFor(packet.requiredSigners ?? []);
  const signers = executionSigners(execution as (ExecutionBlockResult & { signers?: SignerLine[] }) | undefined);
  const groupCount = Number(context ? resolvePath(context, body.noun === "director" ? "dir.count" : "") : NaN);
  const count = signers.length || (Number.isFinite(groupCount) && groupCount > 0 ? groupCount : undefined);
  const orgName = orgField(context, "name");
  const shortName = orgField(context, "shortName") || orgName;
  const dateLong = (context ? String(resolvePath(context, "date.long") ?? "") : "").trim();

  const elements: DocElement[] = [];
  if (orgName) elements.push({ t: "p", style: "Heading1", align: "center", text: orgName.toUpperCase() });
  elements.push({ t: "p", style: "Title", align: "center", text: instrumentTitle(body.noun, count, packet.templateName) });
  elements.push({ t: "p", style: "Subtitle", align: "center", text: state.subtitle ?? packet.templateName });
  elements.push(...sections);

  // Execution group: Dated, adoption clause and signatures stay together.
  const resolutionsPlural = state.clauseCount > 0
    ? state.clauseCount > 1
    : packet.sections.reduce((sum, section) => sum + section.body.length, 0) > 1;
  const omitAdoption = Boolean(context && resolvePath(context, "omitAdoptionClause"));
  let adoption: string | undefined;
  if (state.adoption.length) adoption = state.adoption.join(" ");
  else if (omitAdoption) adoption = undefined;
  else if (french) adoption = execution?.adoptionClause;
  else adoption = consentAdoptionClause({
    noun: body.noun,
    count: count ?? 2,
    shortName,
    legislation: orgField(context, "legislation") || undefined,
    dateLong: dateLong || undefined,
    resolutionsPlural,
  }) ?? execution?.adoptionClause;

  const datedLine = executionDateLine(execution) ?? `${french ? "Daté le" : "Dated"}: ${dateLong || "____________________"}`;
  elements.push({ t: "p", text: datedLine, keepNext: true });
  if (adoption) elements.push({ t: "p", text: adoption, keepNext: true, align: "both" });
  const titleText = instrumentTitle(body.noun, count, packet.templateName).toLowerCase();
  const caption = `[Signature page to the ${titleText}${orgName ? ` of ${orgName}` : ""}${dateLong ? ` dated ${dateLong}` : ""}]`;
  elements.push(signatureTable(signers.length ? signers : [{ name: "" }, { name: "" }], caption));
  return elements;
}

function worksheetElements(packet: RenderablePacket, context?: TemplateValues) {
  const state = newState(context, false, false);
  const sections = renderSectionsToElements(packet.sections, state);
  const elements: DocElement[] = [];
  if (packet.preparationOnly) {
    elements.push({ t: "p", style: "Banner", text: "PREPARATION DRAFT — NOT FOR EXECUTION. Resolve every review prompt and prepare a separate execution copy with the lawful signing authority." });
  }
  elements.push({ t: "p", style: "Title", text: packet.packageName });
  elements.push(...sections);
  return elements;
}

function reportElements(packet: RenderablePacket, context: TemplateValues | undefined, report?: MinuteBookReport) {
  const elements: DocElement[] = [];
  if (!report) {
    elements.push({ t: "p", style: "Title", text: packet.templateName });
    elements.push(...renderSectionsToElements(packet.sections, newState(context, false, false)));
    return elements;
  }
  if (report.restricted) elements.push({ t: "p", style: "Banner", text: "RESTRICTED — see the access notice below." });
  elements.push({ t: "p", style: "Title", text: report.title });
  elements.push({ t: "p", style: "Subtitle", text: report.subtitle });
  // Report blocks carry register data: print them verbatim, never as templates.
  const state = newState(undefined, false, false);
  for (const block of report.blocks) elements.push(...blockElements(block, state, false));
  return elements;
}

function reviewMemoElements(packet: RenderablePacket, context: TemplateValues | undefined, warnings: string[]): DocElement[] {
  const list = (items: readonly string[]) => items.map((text): DocElement => ({ t: "p", text: `- ${text}`, indentLeft: 360 }));
  const signers = packet.requiredSigners?.length ? packet.requiredSigners : ["Review signing requirements before use."];
  return [
    { t: "p", style: "Title", text: "Review memo" },
    { t: "p", style: "Banner", text: `Not part of the ${packet.signatureRequired && !packet.preparationOnly ? "signed instrument" : "document"}. Detach these pages before the document is signed, filed or placed in the minute book.` },
    { t: "p", style: "Heading2", text: packet.packageName },
    { t: "p", text: renderText(packet.summary, context) },
    { t: "p", style: "Heading2", text: "Deliverable" },
    { t: "p", text: renderText(packet.deliverable, context) },
    { t: "p", style: "Heading2", text: "Review terms" },
    { t: "p", text: renderText(packet.terms, context) },
    ...(warnings.length ? [{ t: "p", style: "Heading2", text: "Review flags" } as DocElement, ...list(warnings)] : []),
    { t: "p", style: "Heading2", text: "Required data" },
    ...list(packet.requiredDataFields),
    { t: "p", style: "Heading2", text: "Review data" },
    ...list(packet.reviewDataFields),
    { t: "p", style: "Heading2", text: "Required signers" },
    ...list(signers),
  ];
}

function renderSectionsToElements(sections: readonly PacketBlockSection[], state: RenderState): DocElement[] {
  const elements: DocElement[] = [];
  for (const section of sections) {
    const heading = section.heading ? renderValue(section.heading, state) : "";
    if (heading.trim()) elements.push({ t: "p", style: "Heading2", text: heading, keepNext: true });
    for (const item of section.body) elements.push(...itemElements(item, state));
  }
  return elements;
}

function itemElements(item: PacketBodyItem, state: RenderState): DocElement[] {
  if (typeof item === "string") {
    const text = renderValue(item, state);
    if (!text.trim()) return [];
    if (state.instrument && /^\s*WHEREAS\b/i.test(text)) state.recitalCount += 1;
    if (/BE IT RESOLVED|IL EST RÉSOLU/i.test(text)) state.resolvedEmitted = true;
    return [{ t: "p", text, align: state.instrument ? "both" : undefined }];
  }
  if (!isPacketBlock(item)) return [];
  return blockElements(item, state, true);
}

function renderValue(text: string, state: RenderState): string {
  return state.context ? renderText(text, state.context) : text;
}

function whenAllows(block: PacketBlock, state: RenderState): boolean {
  if (!block.when || !state.context) return true;
  const negate = block.when.startsWith("!");
  const value = resolvePath(state.context, negate ? block.when.slice(1) : block.when);
  const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
  return negate ? !truthy : truthy;
}

function blockElements(block: PacketBlock, state: RenderState, templated: boolean): DocElement[] {
  if (!whenAllows(block, state)) return [];
  const text = (value: string) => (templated ? renderValue(value, state) : value);
  switch (block.kind) {
    case "title":
      state.subtitle = text(block.text);
      return [];
    case "heading":
      return [{ t: "p", style: "Heading2", text: text(block.text), keepNext: true }];
    case "paragraph": {
      const value = text(block.text);
      return value.trim() ? [{ t: "p", text: value, align: state.instrument ? "both" : undefined }] : [];
    }
    case "note": {
      const value = text(block.text);
      return value.trim() ? [{ t: "p", style: "Note", text: value }] : [];
    }
    case "recital": {
      let value = text(block.text).trim();
      if (!value) return [];
      if (!/^(AND\s+)?WHEREAS\b/i.test(value)) value = `${state.recitalCount ? "AND WHEREAS" : "WHEREAS"} ${value}`;
      state.recitalCount += 1;
      return [{ t: "p", text: value, align: "both" }];
    }
    case "resolved":
      state.resolvedEmitted = true;
      return [{ t: "p", text: block.text ? text(block.text) : resolvedWords(state), bold: true, keepNext: true }];
    case "clause": {
      const value = text(block.text);
      if (!value.trim()) return [];
      const lead: DocElement[] = [];
      if (state.instrument && !state.resolvedEmitted) {
        state.resolvedEmitted = true;
        lead.push({ t: "p", text: resolvedWords(state), bold: true, keepNext: true });
      }
      state.clauseCount += 1;
      const number = block.number ? text(block.number) : `${state.clauseCount}.`;
      return [...lead, { t: "p", text: `${number}\t${value}`, indentLeft: 720, hanging: 720, align: "both" }];
    }
    case "adoption": {
      const value = text(block.text);
      if (value.trim()) state.adoption.push(value);
      return [];
    }
    case "table":
      return tableElements(block, state, templated);
    case "signatures": {
      const out: DocElement[] = [];
      if (block.dateLine) out.push({ t: "p", text: text(block.dateLine), keepNext: true });
      out.push(signatureTable(block.signers.map((signer) => ({ name: text(signer.name), capacity: signer.capacity ? text(signer.capacity) : undefined, corpSign: signer.corpSign ? text(signer.corpSign) : null }))));
      return out;
    }
    case "pageBreak":
      return [{ t: "pageBreak" }];
  }
}

function resolvedWords(state: RenderState): string {
  return state.french ? "IL EST RÉSOLU QUE :" : "BE IT RESOLVED THAT:";
}

function tableElements(block: PacketTableBlock, state: RenderState, templated: boolean): DocElement[] {
  const cell = (template: string, item?: unknown) => {
    if (!templated || !state.context) return template;
    if (item === undefined) return renderText(template, state.context);
    return renderTemplate(`{#each __row}${template}{/each}`, { ...state.context, __row: [item] });
  };
  const rows: string[][] = [];
  for (const row of block.rows ?? []) rows.push(row.map((value) => cell(value)));
  if (block.each && block.cells?.length && state.context) {
    const items = resolvePath(state.context, block.each);
    if (Array.isArray(items)) for (const item of items) rows.push(block.cells.map((template) => cell(template, item)));
  }
  if (!rows.length) {
    return block.emptyText ? [{ t: "p", style: "Note", text: templated ? renderValue(block.emptyText, state) : block.emptyText }] : [];
  }
  const header = block.columns.length ? block.columns.map((column) => cell(column)) : null;
  return [{ t: "table", header, rows, widths: block.widths, borders: true }];
}

function signatureTable(signers: ReadonlyArray<SignerLine>, caption?: string): TableElement {
  const cells = signers.map((signer) => {
    if (signer.corpSign) {
      return [signer.corpSign, "", `By: ${SIGNATURE_RULE}`, `Name: ${signer.name}${signer.capacity ? `, ${signer.capacity}` : ""}`, "Authorized signatory"].join("\n");
    }
    return ["", "", SIGNATURE_RULE, `${signer.name || ""}${signer.capacity ? `, ${signer.capacity}` : ""}`].join("\n");
  });
  const rows: string[][] = [];
  for (let index = 0; index < cells.length; index += 2) rows.push([cells[index], cells[index + 1] ?? ""]);
  return { t: "table", header: null, rows, borders: false, keepTogether: true, repeatedCaption: caption };
}

// ---------------------------------------------------------------------------
// WordprocessingML
// ---------------------------------------------------------------------------

function buildElementDocxPackage(elements: DocElement[]) {
  const sectPr = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`;
  const parts: string[] = [];
  for (const element of elements) {
    if (element.t === "section") {
      parts.push(`<w:p><w:pPr>${sectPr}</w:pPr></w:p>`);
    } else if (element.t === "pageBreak") {
      parts.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
    } else if (element.t === "table") {
      parts.push(tableXml(element));
    } else {
      parts.push(paragraphXml(element));
    }
  }
  // A body must not end with a table immediately before the final sectPr.
  if (!elements.length || elements[elements.length - 1].t === "table") parts.push("<w:p/>");
  const documentXmlText = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NS}">
  <w:body>
    ${parts.join("")}
    ${sectPr}
  </w:body>
</w:document>`;
  return createStoredZip({
    "[Content_Types].xml": contentTypesXml(),
    "_rels/.rels": rootRelsXml(),
    "word/document.xml": documentXmlText,
    "word/styles.xml": stylesXml(),
  });
}

function runsXml(text: string, options: { bold?: boolean; italic?: boolean; size?: number } = {}) {
  const rPr = [options.bold ? "<w:b/>" : "", options.italic ? "<w:i/>" : "", options.size ? `<w:sz w:val="${options.size}"/>` : ""].join("");
  const segments = text.split("\n").map((line, lineIndex) => {
    const tabs = line.split("\t").map((part, tabIndex) => `${tabIndex ? "<w:tab/>" : ""}<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join("");
    return `${lineIndex ? "<w:br/>" : ""}${tabs}`;
  }).join("");
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}${segments}</w:r>`;
}

function paragraphXml(element: ParagraphElement) {
  const style = element.style ?? "Normal";
  const pPr = [
    `<w:pStyle w:val="${style}"/>`,
    element.keepNext ? "<w:keepNext/><w:keepLines/>" : "",
    `<w:spacing w:after="120"/>`,
    element.indentLeft || element.hanging ? `<w:ind w:left="${element.indentLeft ?? 0}"${element.hanging ? ` w:hanging="${element.hanging}"` : ""}/>` : "",
    element.align && element.align !== "left" ? `<w:jc w:val="${element.align}"/>` : "",
  ].join("");
  return `<w:p><w:pPr>${pPr}</w:pPr>${runsXml(element.text, { bold: element.bold, italic: element.italic })}</w:p>`;
}

function tableXml(table: TableElement) {
  const columnCount = Math.max(table.header?.length ?? 0, ...table.rows.map((row) => row.length), 1);
  const weights = Array.from({ length: columnCount }, (_, index) => {
    const weight = table.widths?.[index];
    return typeof weight === "number" && weight > 0 ? weight : 1;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => Math.floor((CONTENT_WIDTH * weight) / totalWeight));
  const border = table.borders ? "single" : "nil";
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((side) => `<w:${side} w:val="${border}"${table.borders ? ` w:sz="4" w:space="0" w:color="808080"` : ""}/>`).join("");
  const tblPr = `<w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
  const grid = `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`;
  const allRows: Array<{ cells: string[]; header?: boolean; caption?: boolean }> = [];
  if (table.repeatedCaption) allRows.push({ cells: [table.repeatedCaption], header: true, caption: true });
  if (table.header) allRows.push({ cells: table.header, header: true });
  for (const row of table.rows) allRows.push({ cells: row });
  const rowXml = allRows.map((row, rowIndex) => {
    const last = rowIndex === allRows.length - 1;
    const keepNext = table.keepTogether ? !last : Boolean(row.header);
    const trPr = `<w:trPr><w:cantSplit/>${row.header ? "<w:tblHeader/>" : ""}</w:trPr>`;
    if (row.caption) {
      return `<w:tr>${trPr}<w:tc><w:tcPr><w:tcW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:gridSpan w:val="${columnCount}"/></w:tcPr>${cellParagraphs(row.cells[0], { italic: true, keepNext, size: 18 })}</w:tc></w:tr>`;
    }
    const cells = Array.from({ length: columnCount }, (_, index) => row.cells[index] ?? "");
    return `<w:tr>${trPr}${cells.map((value, index) => `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/>${row.header ? `<w:shd w:val="clear" w:color="auto" w:fill="EDEDED"/>` : ""}</w:tcPr>${cellParagraphs(value, { bold: row.header, keepNext })}</w:tc>`).join("")}</w:tr>`;
  }).join("");
  return `<w:tbl>${tblPr}${grid}${rowXml}</w:tbl>`;
}

function cellParagraphs(value: string, options: { bold?: boolean; italic?: boolean; keepNext?: boolean; size?: number }) {
  const lines = value.split("\n");
  return lines.map((line) => `<w:p><w:pPr>${options.keepNext ? "<w:keepNext/><w:keepLines/>" : ""}<w:spacing w:after="40"/></w:pPr>${runsXml(line, options)}</w:p>`).join("");
}

// Legacy block document (subscription annex and other companion documents).
function buildDocxPackage(title: string, blocks: Array<{ kind: string; text: string }>) {
  return createStoredZip({
    "[Content_Types].xml": contentTypesXml(),
    "_rels/.rels": rootRelsXml(),
    "word/document.xml": documentXml(title, blocks),
    "word/styles.xml": stylesXml(),
  });
}

function documentXml(title: string, blocks: Array<{ kind: string; text: string }>) {
  const body = blocks.map(docxParagraph).join("") || docxParagraph({ kind: "title", text: title });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NS}">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

function docxParagraph(block: { kind: string; text: string }) {
  const style = block.kind === "title" ? "Title" : block.kind === "heading" ? "Heading1" : "Normal";
  const prefix = block.kind === "listItem" ? "- " : "";
  const runs = `${prefix}${block.text}`.split("\n").map((part, index) => `${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join("");
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:spacing w:after="120"/></w:pPr><w:r>${runs}</w:r></w:p>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD_NS}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:pPr><w:spacing w:after="240"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:pPr><w:spacing w:before="280" w:after="120"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:pPr><w:spacing w:after="240"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:sz w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Banner"><w:name w:val="Banner"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="9C2A00"/><w:sz w:val="20"/></w:rPr><w:pPr><w:pBdr><w:top w:val="single" w:sz="6" w:space="2" w:color="9C2A00"/><w:bottom w:val="single" w:sz="6" w:space="2" w:color="9C2A00"/></w:pBdr><w:spacing w:after="200"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="DocId"><w:name w:val="Document ID"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
</w:styles>`;
}

function createStoredZip(files: Record<string, string | Uint8Array>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);
    const localHeader = concatBytes(
      le32(0x04034b50), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(crc), le32(data.length), le32(data.length), le16(nameBytes.length), le16(0), nameBytes,
    );
    const centralHeader = concatBytes(
      le32(0x02014b50), le16(20), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(crc), le32(data.length), le32(data.length), le16(nameBytes.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset), nameBytes,
    );
    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(...centralParts);
  return concatBytes(
    ...localParts,
    centralDirectory,
    le32(0x06054b50), le16(0), le16(0), le16(centralParts.length), le16(centralParts.length), le32(centralDirectory.length), le32(offset), le16(0),
  );
}

function le16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function le32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function base64FromBytes(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    output += alphabet[a >> 2];
    output += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += i + 1 < bytes.length ? alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] : "=";
    output += i + 2 < bytes.length ? alphabet[c & 63] : "=";
  }
  return output;
}

function slugifyForFile(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "corporation-packet";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
