import Fuse from "fuse.js";
import { FIELD_TYPES, type FieldMetadata } from "@/modules/object-record";

export type ImportMappingField = {
  id: string;
  label: string;
  aliases?: string[];
  required?: boolean;
  type?: "text" | "number" | "select" | "multiSelect" | "date" | "boolean";
  options?: { value: string; label: string }[];
  /** Dot path for nested/composite targets, e.g. `address.street`. */
  targetPath?: string;
  /** Convert the raw CSV string before it is committed. */
  transform?: (value: string, row: Record<string, string>) => unknown;
};

export type ImportMappingSuggestion = {
  fieldId: string;
  score: number;
  confidence: "exact" | "high" | "ambiguous" | "low";
  reason: string;
};

export type ImportMappingResult = {
  mapping: Record<number, string>;
  suggestionsByColumn: Record<number, ImportMappingSuggestion[]>;
};

export function suggestImportMappings({
  headers,
  fields,
}: {
  headers: string[];
  fields: ImportMappingField[];
}): ImportMappingResult {
  const mapping: Record<number, string> = {};
  const suggestionsByColumn: Record<number, ImportMappingSuggestion[]> = {};
  const usedFieldIds = new Set<string>();
  const searchableFields = fields.flatMap((field) => [
    { field, label: field.label, reason: "label" },
    { field, label: field.id, reason: "field id" },
    ...(field.aliases ?? []).map((alias) => ({ field, label: alias, reason: "alias" })),
  ]);
  const fuse = new Fuse(searchableFields, {
    keys: ["label"],
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.35,
  });

  headers.forEach((header, index) => {
    const fuzzyByField = new Map<string, { score: number; reason: string }>();
    for (const match of fuse.search(header)) {
      const score = 1 - (match.score ?? 1);
      const current = fuzzyByField.get(match.item.field.id);
      if (!current || score > current.score) {
        fuzzyByField.set(match.item.field.id, { score, reason: match.item.reason });
      }
    }
    const suggestions = fields
      .map((field) => {
        const deterministicScore = scoreHeaderMatch(header, field);
        const fuzzy = fuzzyByField.get(field.id);
        const score = Math.max(deterministicScore, fuzzy?.score ?? 0);
        return {
          fieldId: field.id,
          score,
          confidence: confidenceForScore(score),
          reason: deterministicScore >= (fuzzy?.score ?? 0) ? "name similarity" : `fuzzy ${fuzzy?.reason}`,
        } satisfies ImportMappingSuggestion;
      })
      .filter((suggestion) => suggestion.score > 0.2)
      .sort((a, b) => b.score - a.score);

    suggestionsByColumn[index] = suggestions;

    const best = suggestions[0];
    const second = suggestions[1];
    const isConfident =
      best &&
      best.score >= 0.72 &&
      !usedFieldIds.has(best.fieldId) &&
      (!second || best.score - second.score >= 0.08);

    if (isConfident) {
      mapping[index] = best.fieldId;
      usedFieldIds.add(best.fieldId);
    } else {
      mapping[index] = "";
    }
  });

  return { mapping, suggestionsByColumn };
}

export type ImportValidationIssue = {
  row: number;
  fieldId?: string;
  level: "error" | "warn";
  message: string;
};

export function validateImportedRows({
  rows,
  fields,
  maxRows = 5000,
}: {
  rows: Record<string, string>[];
  fields: ImportMappingField[];
  maxRows?: number;
}): ImportValidationIssue[] {
  const issues: ImportValidationIssue[] = [];
  if (rows.length > maxRows) {
    issues.push({
      row: 0,
      level: "error",
      message: `Import contains ${rows.length} rows; the limit is ${maxRows}.`,
    });
  }
  rows.forEach((row, index) => {
    for (const field of fields) {
      const value = row[field.id]?.trim() ?? "";
      if (field.required && !value) {
        issues.push({ row: index + 2, fieldId: field.id, level: "error", message: `Missing ${field.label}` });
      }
      if (!value) continue;
      if ((field.type === "select" || field.type === "multiSelect") && field.options?.length) {
        const allowed = new Set(field.options.flatMap((option) => [option.value, option.label]));
        const values = field.type === "multiSelect" ? value.split(/[;,]/).map((entry) => entry.trim()).filter(Boolean) : [value];
        for (const entry of values) {
          if (!allowed.has(entry)) {
            issues.push({
              row: index + 2,
              fieldId: field.id,
              level: "warn",
              message: `${field.label}: "${entry}" is not a configured option`,
            });
          }
        }
      }
      if (field.type === "number" && Number.isNaN(Number(value))) {
        issues.push({ row: index + 2, fieldId: field.id, level: "error", message: `${field.label} must be a number` });
      }
      if (field.type === "date" && Number.isNaN(Date.parse(value))) {
        issues.push({ row: index + 2, fieldId: field.id, level: "warn", message: `${field.label} is not a recognizable date` });
      }
      if (field.type === "boolean" && parseBoolean(value) === undefined) {
        issues.push({ row: index + 2, fieldId: field.id, level: "warn", message: `${field.label} should be yes/no or true/false` });
      }
    }
  });
  return issues;
}

export function buildImportFieldsFromMetadata(fields: FieldMetadata[]): ImportMappingField[] {
  return fields
    .filter((field) => !field.isHidden && !field.isReadOnly)
    .map((field) => {
      const type = importFieldTypeForMetadata(field);
      const options = Array.isArray(field.config?.options)
        ? field.config.options.map((option: any) => ({
            value: String(option.value),
            label: String(option.label ?? option.value),
          }))
        : undefined;
      return {
        id: field.name,
        label: field.label,
        aliases: [
          field.name,
          field.label,
          field.description,
          field.icon,
        ].filter((value): value is string => Boolean(value)),
        required: !field.isNullable && field.defaultValue === undefined,
        type,
        options,
      } satisfies ImportMappingField;
    });
}

export function buildRecordFromImportedRow({
  row,
  fields,
}: {
  row: Record<string, string>;
  fields: ImportMappingField[];
}): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = row[field.id]?.trim() ?? "";
    if (!raw) continue;
    const value = field.transform ? field.transform(raw, row) : normalizeImportedValue(raw, field);
    setPath(record, field.targetPath ?? field.id, value);
  }
  return record;
}

export function normalizeImportedValue(value: string, field: Pick<ImportMappingField, "type" | "options">): unknown {
  if (field.type === "number") return Number(value);
  if (field.type === "boolean") return parseBoolean(value) ?? value;
  if (field.type === "multiSelect") {
    return value
      .split(/[;,]/)
      .map((entry) => normalizeSelectOption(entry.trim(), field.options))
      .filter(Boolean);
  }
  if (field.type === "select") return normalizeSelectOption(value, field.options);
  if (field.type === "date") return value.slice(0, 10);
  return value;
}

function importFieldTypeForMetadata(field: FieldMetadata): ImportMappingField["type"] {
  switch (field.fieldType) {
    case FIELD_TYPES.NUMBER:
    case FIELD_TYPES.CURRENCY:
    case FIELD_TYPES.RATING:
      return "number";
    case FIELD_TYPES.SELECT:
      return "select";
    case FIELD_TYPES.MULTI_SELECT:
    case FIELD_TYPES.ARRAY:
      return "multiSelect";
    case FIELD_TYPES.DATE:
    case FIELD_TYPES.DATE_TIME:
      return "date";
    case FIELD_TYPES.BOOLEAN:
      return "boolean";
    default:
      return "text";
  }
}

function normalizeSelectOption(value: string, options?: { value: string; label: string }[]) {
  if (!options?.length) return value;
  const normalized = normalize(value);
  const option = options.find((entry) =>
    normalize(entry.value) === normalized || normalize(entry.label) === normalized
  );
  return option?.value ?? value;
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1", "active"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(normalized)) return false;
  return undefined;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cursor: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const current = cursor[part];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function confidenceForScore(score: number): ImportMappingSuggestion["confidence"] {
  if (score >= 0.98) return "exact";
  if (score >= 0.72) return "high";
  if (score >= 0.55) return "ambiguous";
  return "low";
}

function scoreHeaderMatch(header: string, field: ImportMappingField): number {
  const normalizedHeader = normalize(header);
  const normalizedId = normalize(field.id);
  const normalizedLabel = normalize(field.label);
  const compactHeader = compact(normalizedHeader);
  const compactId = compact(normalizedId);
  const compactLabel = compact(normalizedLabel);

  if (!compactHeader) return 0;
  if (compactHeader === compactId || compactHeader === compactLabel) return 1;

  const candidates = [normalizedId, normalizedLabel];
  let best = 0;
  for (const candidate of candidates) {
    const compactCandidate = compact(candidate);
    if (!compactCandidate) continue;
    if (compactCandidate.includes(compactHeader) || compactHeader.includes(compactCandidate)) {
      best = Math.max(best, 0.84);
    }
    best = Math.max(best, tokenOverlap(normalizedHeader, candidate));
    best = Math.max(best, 1 - levenshtein(compactHeader, compactCandidate) / Math.max(compactHeader.length, compactCandidate.length));
  }
  return best;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}
