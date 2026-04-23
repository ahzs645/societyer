type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PdfFieldInspection = {
  name: string;
  type?: string;
  rects?: PdfRect[];
  value?: unknown;
};

type RepeatedFieldEntry = {
  field: PdfFieldInspection;
  row: number;
};

type RepeatedColumn = {
  key: string;
  label: string;
  fieldType: string;
  entries: RepeatedFieldEntry[];
  bounds: PdfRect | null;
};

type LayoutTableCandidate = {
  kind: "layoutText";
  page: number;
  lineNumber: number;
  headers: string[];
  rows: string[][];
  confidence: "medium" | "low";
};

type NormalizedColumn = {
  key: string;
  label: string;
  fieldType: string;
  position: number;
  fieldNames: string[];
  bound: boolean;
  readOnly: boolean;
  source: "acroform" | "layout";
};

type NormalizedRow = {
  _id: string;
  rowIndex: number;
  rowNumber: number;
  values: Record<string, unknown>;
  fieldNamesByColumn: Record<string, string[]>;
  sourceFieldNames: string[];
};

export type NormalizedPdfTable = {
  kind: "normalizedPdfTable";
  key: string;
  label: string;
  confidence: "high" | "medium" | "low" | "review";
  source: "acroform" | "layoutText";
  rowCount: number;
  columns: NormalizedColumn[];
  rows: NormalizedRow[];
  bounds: PdfRect | null;
  notes: string;
  recordTable: Record<string, unknown>;
};

export function normalizePdfTableStructures(input: {
  fields: PdfFieldInspection[];
  layoutText?: string;
  metadata?: Record<string, unknown>;
}): NormalizedPdfTable[] {
  const fields = Array.isArray(input.fields) ? input.fields : [];
  const layoutTables = detectLayoutTextTableCandidates(input.layoutText ?? "");
  const repeatedTables = clusterRepeatedColumns(repeatedColumnsFromFields(fields));
  const normalized: NormalizedPdfTable[] = [];
  const usedLayoutLines = new Set<number>();

  for (const table of repeatedTables) {
    const layout = bestLayoutMatch(table.columns, layoutTables);
    if (layout) usedLayoutLines.add(layout.lineNumber);
    normalized.push(normalizeRepeatedTable(table, layout, input.metadata));
  }

  for (const layout of layoutTables) {
    if (usedLayoutLines.has(layout.lineNumber) || layout.rows.length === 0) continue;
    normalized.push(normalizeLayoutOnlyTable(layout, input.metadata));
  }

  return normalized;
}

export function buildPdfTableImportBundle(input: {
  tables: NormalizedPdfTable[];
  metadata?: Record<string, unknown>;
  source?: Record<string, unknown>;
}) {
  const metadata = input.metadata ?? {};
  const source = input.source ?? {};
  const fileName = cleanText(source.fileName) ?? cleanText(metadata.fileName);
  const sourceTitle =
    cleanText(source.title) ??
    cleanText(metadata.title) ??
    cleanText(fileName) ??
    "PDF template inspection";
  const sourceExternalId =
    cleanText(source.externalId) ??
    cleanText(metadata.documentId) ??
    cleanText(metadata.sourcePath) ??
    cleanText(fileName) ??
    slugifyKey(sourceTitle);
  const externalSystem = cleanText(source.externalSystem) ?? "workflow-pdf";
  const sourceExternalIds = [`${externalSystem}:${sourceExternalId}`];
  const nowDate = new Date().toISOString().slice(0, 10);
  const dataFields = input.tables.flatMap((table) =>
    table.columns.map((column) => ({
      name: `${table.key}.${column.key}`,
      label: column.label,
      fieldType: importFieldType(column.fieldType),
      number: column.position + 1,
      dynamicIndicator: column.bound ? "pdf_acroform_field" : "pdf_layout_header",
      required: false,
      reviewRequired: !column.bound,
      notes: [
        `Detected in PDF table "${table.label}".`,
        column.bound
          ? `Bound AcroForm fields: ${column.fieldNames.join(", ")}.`
          : "No AcroForm field was found for this visible column; review before using it in automation.",
      ].join(" "),
      sourceExternalIds,
      confidence: column.bound ? table.confidence : "Review",
    })),
  );
  const optionalDataFields = dataFields.map((field) => field.name);
  const reviewDataFields = dataFields
    .filter((field) => field.reviewRequired)
    .map((field) => field.name);

  return {
    metadata: {
      name: "PDF table normalization",
      createdFrom: externalSystem,
      fileName,
      sourceTitle,
      normalizedTables: input.tables.length,
      normalizedRows: input.tables.reduce((sum, table) => sum + table.rows.length, 0),
      normalizedColumns: input.tables.reduce((sum, table) => sum + table.columns.length, 0),
      note: "PDF AcroForm/table structure was normalized into record-table previews and legal template data-field candidates. Review before applying.",
    },
    sources: [
      {
        externalSystem,
        externalId: sourceExternalIds[0],
        title: sourceTitle,
        sourceDate: cleanText(source.sourceDate) ?? nowDate,
        category: "PDF Template",
        confidence: input.tables.length > 0 ? "Medium" : "Review",
        notes: "Source PDF inspected for fillable fields, visible table headers, and row structure.",
        localPath: cleanText(source.localPath) ?? cleanText(metadata.sourcePath),
        fileName,
        mimeType: cleanText(source.mimeType) ?? "application/pdf",
        tags: ["pdf-template", "pdf-table-normalization"],
      },
    ],
    legalTemplateDataFields: dataFields,
    legalTemplates: [
      {
        templateType: "document",
        name: sourceTitle,
        status: "needs_review",
        optionalDataFields,
        reviewDataFields,
        requiredDataFields: [],
        requiredSigners: [],
        entityTypes: [],
        jurisdictions: [],
        priceItems: [],
        documentTag: "other",
        notes: `Detected ${dataFields.length} data fields across ${input.tables.length} normalized PDF table(s).`,
        sourceExternalIds,
        confidence: input.tables.length > 0 ? "Medium" : "Review",
      },
    ],
    sourceEvidence: input.tables.map((table) => ({
      externalSystem,
      externalId: `${sourceExternalIds[0]}:table:${table.key}`,
      sourceTitle: `${sourceTitle} - ${table.label}`,
      sourceDate: nowDate,
      evidenceKind: "pdf_table_normalization",
      targetTable: "legalTemplateDataFields",
      sensitivity: "standard",
      accessLevel: "internal",
      summary: `${table.rowCount} row(s), ${table.columns.length} column(s): ${table.columns.map((column) => column.label).join(", ")}.`,
      status: "NeedsReview",
      notes: table.notes,
      sourceExternalIds,
      confidence: table.confidence,
    })),
    recordTables: input.tables.map((table) => table.recordTable),
  };
}

function normalizeRepeatedTable(
  table: { columns: RepeatedColumn[]; bounds: PdfRect | null },
  layout: LayoutTableCandidate | null,
  metadata?: Record<string, unknown>,
): NormalizedPdfTable {
  const label = layout?.headers[0] ?? table.columns[0]?.label ?? "Detected PDF table";
  const key = uniqueTableKey(label, metadata);
  const rowNumbers = Array.from(
    new Set(table.columns.flatMap((column) => column.entries.map((entry) => entry.row))),
  ).sort((a, b) => a - b);
  const columns = columnsForRepeatedTable(table.columns, layout);
  const rows = rowNumbers.map((rowNumber, index) =>
    normalizedRow(key, rowNumber, index, columns, table.columns, layout?.rows[index]),
  );
  const unboundCount = columns.filter((column) => !column.bound).length;
  const normalized: Omit<NormalizedPdfTable, "recordTable"> = {
    kind: "normalizedPdfTable",
    key,
    label,
    confidence: layout ? (unboundCount > 0 ? "medium" : "high") : "medium",
    source: "acroform",
    rowCount: rows.length,
    columns,
    rows,
    bounds: table.bounds,
    notes: layout
      ? "Repeated AcroForm rows were merged with visible PDF text headers."
      : "Detected from repeated AcroForm field names. No visible layout headers were available.",
  };
  return { ...normalized, recordTable: recordTableShape(normalized) };
}

function normalizeLayoutOnlyTable(
  layout: LayoutTableCandidate,
  metadata?: Record<string, unknown>,
): NormalizedPdfTable {
  const key = uniqueTableKey(layout.headers[0] ?? "layout_text_table", metadata);
  const columns = layout.headers.map((header, index) => ({
    key: uniqueColumnKey(header, index, []),
    label: titleCaseLabel(header),
    fieldType: guessFieldType(header),
    position: index,
    fieldNames: [],
    bound: false,
    readOnly: true,
    source: "layout" as const,
  }));
  const rows = layout.rows.map((row, index) => ({
    _id: `${key}_row_${index + 1}`,
    rowIndex: index,
    rowNumber: index + 1,
    values: Object.fromEntries(columns.map((column, columnIndex) => [column.key, row[columnIndex] ?? ""])),
    fieldNamesByColumn: Object.fromEntries(columns.map((column) => [column.key, []])),
    sourceFieldNames: [],
  }));
  const normalized: Omit<NormalizedPdfTable, "recordTable"> = {
    kind: "normalizedPdfTable",
    key,
    label: titleCaseLabel(layout.headers[0] ?? "Layout text table"),
    confidence: layout.confidence,
    source: "layoutText",
    rowCount: rows.length,
    columns,
    rows,
    bounds: null,
    notes: "Detected from layout text only. Review column alignment before applying.",
  };
  return { ...normalized, recordTable: recordTableShape(normalized) };
}

function columnsForRepeatedTable(columns: RepeatedColumn[], layout: LayoutTableCandidate | null): NormalizedColumn[] {
  const headers = layout?.headers ?? [];
  const normalized: NormalizedColumn[] = [];
  const usedRepeated = new Set<number>();
  const shouldUseAllHeaders =
    headers.length > columns.length &&
    columns.length > 0 &&
    bestHeaderScore(columns[0].label, headers[0]) >= 0.55;

  const columnCount = shouldUseAllHeaders ? headers.length : Math.max(headers.length, columns.length);
  for (let index = 0; index < columnCount; index++) {
    const header = headers[index];
    const repeatedIndex = findRepeatedColumnIndex(header, index, columns, usedRepeated);
    const repeated = repeatedIndex >= 0 ? columns[repeatedIndex] : undefined;
    if (repeatedIndex >= 0) usedRepeated.add(repeatedIndex);
    const label = titleCaseLabel(header ?? repeated?.label ?? `Column ${index + 1}`);
    normalized.push({
      key: uniqueColumnKey(label, index, normalized.map((column) => column.key)),
      label,
      fieldType: repeated?.fieldType ?? guessFieldType(label),
      position: index,
      fieldNames: repeated?.entries.map((entry) => entry.field.name) ?? [],
      bound: Boolean(repeated),
      readOnly: !repeated,
      source: repeated ? "acroform" : "layout",
    });
  }

  columns.forEach((column, repeatedIndex) => {
    if (usedRepeated.has(repeatedIndex)) return;
    const index = normalized.length;
    normalized.push({
      key: uniqueColumnKey(column.label, index, normalized.map((entry) => entry.key)),
      label: titleCaseLabel(column.label),
      fieldType: column.fieldType,
      position: index,
      fieldNames: column.entries.map((entry) => entry.field.name),
      bound: true,
      readOnly: false,
      source: "acroform",
    });
  });

  return normalized;
}

function normalizedRow(
  tableKey: string,
  rowNumber: number,
  rowIndex: number,
  columns: NormalizedColumn[],
  repeatedColumns: RepeatedColumn[],
  layoutValues?: string[],
): NormalizedRow {
  const values: Record<string, unknown> = {};
  const fieldNamesByColumn: Record<string, string[]> = {};
  const sourceFieldNames: string[] = [];

  columns.forEach((column, columnIndex) => {
    const repeated = repeatedColumns.find((candidate) =>
      candidate.entries.some((entry) => column.fieldNames.includes(entry.field.name)),
    );
    const entry = repeated?.entries.find((candidate) => candidate.row === rowNumber);
    const value = entry?.field.value ?? layoutValues?.[columnIndex] ?? "";
    values[column.key] = value;
    const fieldNames = entry ? [entry.field.name] : [];
    fieldNamesByColumn[column.key] = fieldNames;
    sourceFieldNames.push(...fieldNames);
  });

  return {
    _id: `${tableKey}_row_${rowNumber}`,
    rowIndex,
    rowNumber,
    values,
    fieldNamesByColumn,
    sourceFieldNames,
  };
}

function recordTableShape(table: Omit<NormalizedPdfTable, "recordTable">) {
  const objectId = `pdf_object_${table.key}`;
  const viewId = `pdf_view_${table.key}`;
  const objectMetadata = {
    _id: objectId,
    nameSingular: `${table.key}_row`,
    namePlural: `${table.key}_rows`,
    labelSingular: `${table.label} row`,
    labelPlural: table.label,
    labelIdentifierFieldName: table.columns[0]?.key,
    isSystem: false,
    isActive: true,
    routePath: "/app/imports",
    fields: table.columns.map((column) => fieldMetadataShape(objectId, table.key, column)),
  };
  return {
    tableId: table.key,
    objectMetadata,
    hydratedView: {
      view: {
        _id: viewId,
        objectMetadataId: objectId,
        name: `All ${table.label}`,
        type: "table",
        filters: [],
        sorts: [],
        density: "compact",
        isShared: false,
        isSystem: true,
        position: 0,
      },
      columns: table.columns.map((column) => ({
        viewFieldId: `pdf_view_field_${table.key}_${column.key}`,
        fieldMetadataId: `pdf_field_${table.key}_${column.key}`,
        position: column.position,
        size: defaultColumnSize(column),
        isVisible: true,
        aggregateOperation: null,
        field: fieldMetadataShape(objectId, table.key, column),
      })),
    },
    records: table.rows.map((row) => ({
      _id: row._id,
      ...row.values,
      __pdf: {
        rowNumber: row.rowNumber,
        sourceFieldNames: row.sourceFieldNames,
        fieldNamesByColumn: row.fieldNamesByColumn,
      },
    })),
  };
}

function fieldMetadataShape(objectId: string, tableKey: string, column: NormalizedColumn) {
  return {
    _id: `pdf_field_${tableKey}_${column.key}`,
    objectMetadataId: objectId,
    name: column.key,
    label: column.label,
    fieldType: column.fieldType,
    config: {},
    defaultValue: undefined,
    isSystem: column.position === 0,
    isHidden: false,
    isNullable: true,
    isReadOnly: column.readOnly,
    position: column.position,
  };
}

function repeatedColumnsFromFields(fields: PdfFieldInspection[]): RepeatedColumn[] {
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const groups = new Map<string, RepeatedFieldEntry[]>();
  for (const field of fields) {
    const parsed = parseRepeatedFieldName(field.name);
    if (!parsed) continue;
    const entries = groups.get(parsed.base) ?? [];
    entries.push({ field, row: parsed.row });
    groups.set(parsed.base, entries);
  }

  for (const [base, entries] of groups) {
    if (!entries.some((entry) => entry.row === 1)) {
      const baseField = fieldsByName.get(base);
      if (baseField) entries.push({ field: baseField, row: 1 });
    }
  }

  return Array.from(groups.entries())
    .map(([base, entries]) => {
      const sorted = entries.sort((a, b) => a.row - b.row);
      const rows = new Set(sorted.map((entry) => entry.row));
      if (rows.size < 2) return null;
      return {
        key: slugifyKey(base),
        label: base,
        fieldType: guessFieldType(base, sorted[0]?.field.type),
        entries: sorted,
        bounds: boundsForRects(sorted.map((entry) => entry.field.rects?.[0]).filter(Boolean) as PdfRect[]),
      };
    })
    .filter((column): column is RepeatedColumn => Boolean(column));
}

function clusterRepeatedColumns(columns: RepeatedColumn[]) {
  const sorted = [...columns].sort((a, b) => rectX(a.bounds) - rectX(b.bounds));
  const tables: Array<{ columns: RepeatedColumn[]; bounds: PdfRect | null }> = [];
  for (const column of sorted) {
    const target = tables.find((table) => columnsAlign(table.columns[0], column));
    if (target) {
      target.columns.push(column);
      target.bounds = boundsForRects(target.columns.map((entry) => entry.bounds).filter(Boolean) as PdfRect[]);
    } else {
      tables.push({ columns: [column], bounds: column.bounds });
    }
  }
  return tables;
}

function columnsAlign(left?: RepeatedColumn, right?: RepeatedColumn) {
  if (!left || !right) return false;
  if (left.entries.length !== right.entries.length) return false;
  return left.entries.every((entry, index) => {
    const other = right.entries[index];
    const y = entry.field.rects?.[0]?.y;
    const otherY = other?.field.rects?.[0]?.y;
    return typeof y === "number" && typeof otherY === "number" ? Math.abs(y - otherY) <= 8 : true;
  });
}

function detectLayoutTextTableCandidates(text: string): LayoutTableCandidate[] {
  const lines = String(text ?? "").split(/\r?\n/);
  const candidates: LayoutTableCandidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const columns = splitLayoutColumns(lines[i]);
    if (columns.length < 2) continue;
    if (!looksLikeHeader(columns)) continue;
    const rows: string[][] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = splitLayoutColumns(lines[j]);
      if (next.length === 0) {
        if (rows.length > 0) break;
        continue;
      }
      if (next.length < Math.max(2, columns.length - 1)) break;
      rows.push(next.slice(0, columns.length));
    }
    candidates.push({
      kind: "layoutText",
      page: 1,
      lineNumber: i + 1,
      headers: columns,
      rows,
      confidence: columns.length >= 3 ? "medium" : "low",
    });
  }
  return candidates;
}

function bestLayoutMatch(columns: RepeatedColumn[], candidates: LayoutTableCandidate[]) {
  let best: { candidate: LayoutTableCandidate; score: number } | null = null;
  for (const candidate of candidates) {
    const score = Math.max(
      ...columns.flatMap((column) => candidate.headers.map((header) => bestHeaderScore(column.label, header))),
      0,
    );
    if (!best || score > best.score) best = { candidate, score };
  }
  return best && best.score >= 0.45 ? best.candidate : null;
}

function bestHeaderScore(label: string, header: string) {
  const left = tokenSet(label);
  const right = tokenSet(header);
  if (left.size === 0 || right.size === 0) return 0;
  let hits = 0;
  for (const token of left) {
    if (right.has(token)) hits += 1;
  }
  return hits / Math.max(left.size, right.size);
}

function findRepeatedColumnIndex(
  header: string | undefined,
  index: number,
  columns: RepeatedColumn[],
  used: Set<number>,
) {
  if (header) {
    let best = { index: -1, score: 0 };
    columns.forEach((column, candidateIndex) => {
      if (used.has(candidateIndex)) return;
      const score = bestHeaderScore(column.label, header);
      if (score > best.score) best = { index: candidateIndex, score };
    });
    if (best.score >= 0.45) return best.index;
  }
  return !used.has(index) && columns[index] ? index : -1;
}

function parseRepeatedFieldName(name: string) {
  const match = String(name).match(/^(.*?)(?:\s+(\d+))$/);
  if (!match) return null;
  const base = match[1].trim();
  const row = Number(match[2]);
  if (!base || !Number.isFinite(row) || row < 2) return null;
  return { base, row };
}

function splitLayoutColumns(line: string) {
  return String(line ?? "")
    .trim()
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikeHeader(columns: string[]) {
  const joined = columns.join(" ");
  if (/\b(room|number|date|issued|deposit|amount|fund|account|org|key|name|email|phone)\b/i.test(joined)) {
    return true;
  }
  return columns.length >= 3 && columns.every((column) => /[A-Za-z]/.test(column));
}

function boundsForRects(rects: PdfRect[]) {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: roundNumber(minX),
    y: roundNumber(minY),
    width: roundNumber(maxX - minX),
    height: roundNumber(maxY - minY),
  };
}

function guessFieldType(label: string, pdfType?: string) {
  if (pdfType === "checkbox") return "BOOLEAN";
  if (/\b(date|issued|expires?|expiry)\b/i.test(label)) return "DATE";
  if (/\b(amount|deposit|fee|total|premium|balance|price|cost)\b/i.test(label)) return "CURRENCY";
  if (/\b(email)\b/i.test(label)) return "EMAIL";
  if (/\b(phone|telephone)\b/i.test(label)) return "PHONE";
  if (/\b(number|#|count|qty|quantity)\b/i.test(label) && !/\b(room|phone|account|id)\b/i.test(label)) return "NUMBER";
  return "TEXT";
}

function importFieldType(fieldType: string) {
  const map: Record<string, string> = {
    BOOLEAN: "boolean",
    DATE: "date",
    CURRENCY: "currency",
    EMAIL: "email",
    PHONE: "phone",
    NUMBER: "number",
    TEXT: "text",
  };
  return map[fieldType] ?? "text";
}

function defaultColumnSize(column: NormalizedColumn) {
  if (column.fieldType === "DATE") return 150;
  if (column.fieldType === "CURRENCY") return 130;
  if (column.label.length > 22) return 240;
  return 180;
}

function uniqueTableKey(label: string, metadata?: Record<string, unknown>) {
  const suffix = cleanText(metadata?.documentId) ?? cleanText(metadata?.fileName) ?? cleanText(metadata?.sourcePath);
  const suffixKey = suffix ? `_${shortHash(suffix)}` : "";
  return `${slugifyKey(label) || "pdf_table"}${suffixKey}`;
}

function uniqueColumnKey(label: string, index: number, used: string[]) {
  const base = slugifyKey(label) || `column_${index + 1}`;
  if (!used.includes(base)) return base;
  let suffix = 2;
  while (used.includes(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function slugifyKey(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#/g, " number ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function titleCaseLabel(value: string) {
  const clean = String(value ?? "").replace(/\s+/g, " ").replace(/\s*\/\s*/g, " / ").trim();
  if (!clean) return "Column";
  if (/[a-z]/.test(clean)) return clean;
  return clean
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bId\b/g, "ID")
    .replace(/\s*\/\s*/g, " / ");
}

function tokenSet(value: string) {
  return new Set(
    slugifyKey(value)
      .split("_")
      .filter((token) => token && !["the", "a", "an", "of"].includes(token)),
  );
}

function rectX(rect: PdfRect | null) {
  return rect?.x ?? Number.MAX_SAFE_INTEGER;
}

function roundNumber(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function shortHash(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}
