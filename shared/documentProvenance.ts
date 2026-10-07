/**
 * Readable provenance for a document record (findings D-02, D-13, D-15).
 *
 * Imported documents keep their source facts inside `content` as JSON in
 * several historical shapes (`sha256` at the top, `source.sha256`,
 * `originalSHA256`; `localPath`, `source.path`, an "Original folder path:"
 * line in notes; …). This module reads them into one shape for list columns,
 * duplicate detection and the detail page, without the caller parsing JSON.
 *
 * Pure. `documentProvenanceCached` memoizes per document id and content string,
 * so a reactive list re-run does not re-parse unchanged content.
 */

export type DocumentProvenance = {
  contentKind: "none" | "json" | "text";
  sha256?: string;
  externalIds: string[];
  sourceSystem?: string;
  sourcePath?: string;
  sourceDate?: string;
  importSessionId?: string;
  importedFrom?: string;
  extractionMethod?: string;
  extractedTextLength?: number;
  excerpt?: string;
  note?: string;
};

const SOURCE_SYSTEM_LABELS: Record<string, string> = {
  "google-drive": "Google Drive",
  gdrive: "Google Drive",
  drive: "Google Drive",
  paperless: "Paperless",
  onedrive: "OneDrive",
  sharepoint: "SharePoint",
  dropbox: "Dropbox",
  box: "Box",
  local: "Local file",
  upload: "Uploaded",
  "bc-registry": "BC Registry",
  "bc_registry": "BC Registry",
};
const EXTERNAL_ID_SYSTEMS = /^(google-drive|gdrive|drive|paperless|onedrive|sharepoint|dropbox|box|bc-registry|bc_registry)$/i;

export function sourceSystemLabel(system: string | undefined) {
  if (!system) return undefined;
  return SOURCE_SYSTEM_LABELS[system.toLowerCase()] ?? system.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "google-drive:abc" → "google-drive"; undefined for non-provenance strings. */
export function externalIdSystem(value: unknown) {
  const text = String(value ?? "");
  const separator = text.indexOf(":");
  if (separator <= 0) return undefined;
  const system = text.slice(0, separator);
  return EXTERNAL_ID_SYSTEMS.test(system) ? system.toLowerCase() : undefined;
}

function driveIdFromUrl(url: unknown) {
  const match = String(url ?? "").match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]{10,})/);
  return match ? `google-drive:${match[1]}` : undefined;
}

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function shaOf(value: unknown) {
  const text = str(value)?.toLowerCase();
  return text && /^[a-f0-9]{64}$/.test(text) ? text : undefined;
}

const DATE_LIKE = /^\d{4}(-\d{2}(-\d{2})?)?/;
function dateOf(value: unknown) {
  const text = str(value);
  return text && DATE_LIKE.test(text) ? text.slice(0, 10) : undefined;
}

export function parseDocumentContent(content: unknown): { kind: "none" | "json" | "text"; value: any } {
  if (typeof content !== "string" || !content.trim()) return { kind: "none", value: undefined };
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { kind: "json", value: JSON.parse(content) };
    } catch {
      // Not JSON after all; fall through to text.
    }
  }
  return { kind: "text", value: content };
}

export function documentProvenance(doc: {
  content?: unknown;
  url?: unknown;
  tags?: unknown;
  sourceExternalIds?: unknown;
  importSessionId?: unknown;
  storageId?: unknown;
}): DocumentProvenance {
  const parsed = parseDocumentContent(doc.content);
  const json = parsed.kind === "json" && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value : undefined;
  const source = json?.source && typeof json.source === "object" ? json.source : undefined;
  const externalIds = new Set<string>();
  const addId = (value: unknown) => {
    const text = str(value);
    if (text && externalIdSystem(text)) externalIds.add(text);
  };
  for (const id of Array.isArray(doc.sourceExternalIds) ? doc.sourceExternalIds : []) addId(id);
  if (json) {
    addId(json.externalId);
    for (const id of Array.isArray(json.sourceExternalIds) ? json.sourceExternalIds : []) addId(id);
    if (str(json.sourceDriveId)) addId(`google-drive:${json.sourceDriveId}`);
    if (source && str(source.id) && /drive\.google\.com/.test(String(source.url ?? ""))) addId(`google-drive:${source.id}`);
  }
  for (const tag of Array.isArray(doc.tags) ? doc.tags : []) addId(tag);
  const fromUrl = driveIdFromUrl(doc.url ?? source?.url);
  if (fromUrl) addId(fromUrl);

  const notes = str(json?.notes) ?? str(json?.note) ?? str(source?.notes);
  const folderLine = notes?.match(/Original folder path:\s*(.+)/i)?.[1]?.trim();
  const extractedText = str(json?.extractedText) ?? str(json?.text) ?? (parsed.kind === "text" ? str(parsed.value) : undefined);
  const firstExternal = [...externalIds][0];
  const system = str(json?.externalSystem)?.toLowerCase()
    ?? externalIdSystem(firstExternal)
    ?? (/drive\.google\.com/.test(String(doc.url ?? "")) ? "google-drive" : undefined)
    ?? (Array.isArray(doc.tags) && doc.tags.some((tag) => String(tag).startsWith("google-drive")) ? "google-drive" : undefined)
    ?? (Array.isArray(doc.tags) && doc.tags.some((tag) => String(tag).startsWith("paperless")) ? "paperless" : undefined)
    ?? (doc.storageId ? "upload" : undefined);

  return {
    contentKind: parsed.kind,
    sha256: shaOf(json?.sha256) ?? shaOf(source?.sha256) ?? shaOf(json?.originalSHA256) ?? shaOf(json?.originalSha256),
    externalIds: [...externalIds],
    sourceSystem: system,
    sourcePath: str(json?.localPath) ?? str(source?.path) ?? str(json?.originalFile) ?? str(json?.sourcePath) ?? folderLine,
    sourceDate: dateOf(json?.sourceDate) ?? dateOf(json?.documentDate) ?? dateOf(json?.date) ?? dateOf(json?.created) ?? dateOf(source?.modifiedTime) ?? dateOf(source?.createdTime),
    importSessionId: str(json?.importSessionId) ?? str(doc.importSessionId),
    importedFrom: str(json?.importedFrom),
    extractionMethod: str(json?.extractionMethod) ?? str(source?.extractionMethod),
    extractedTextLength: extractedText?.length,
    excerpt: extractedText ? excerptOf(extractedText, 280) : undefined,
    note: str(json?.note) ?? notes,
  };
}

export function excerptOf(text: string, length: number) {
  const compact = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return compact.length > length ? `${compact.slice(0, length - 1).trimEnd()}…` : compact;
}

const PROVENANCE_CACHE = new Map<string, { content: unknown; url: unknown; tags: unknown; value: DocumentProvenance }>();

export function documentProvenanceCached(doc: Parameters<typeof documentProvenance>[0] & { _id?: unknown }) {
  const id = doc._id ? String(doc._id) : "";
  if (!id) return documentProvenance(doc);
  const cached = PROVENANCE_CACHE.get(id);
  if (cached && cached.content === doc.content && cached.url === doc.url && sameTags(cached.tags, doc.tags)) return cached.value;
  const value = documentProvenance(doc);
  PROVENANCE_CACHE.set(id, { content: doc.content, url: doc.url, tags: Array.isArray(doc.tags) ? [...doc.tags] : doc.tags, value });
  return value;
}

function sameTags(a: unknown, b: unknown) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

/* --------------------------- readable content ----------------------------- */

export type ReadableField = {
  path: string;
  label: string;
  kind: "text" | "longText" | "list" | "table" | "group";
  value?: string;
  items?: string[];
  rows?: string[][];
  children?: ReadableField[];
};

const LABEL_OVERRIDES: Record<string, string> = {
  sha256: "SHA-256",
  originalSHA256: "Original SHA-256",
  url: "Link",
  id: "Id",
  externalId: "External id",
  sourceExternalIds: "Source ids",
  importSessionId: "Import session",
  extractedText: "Extracted text",
  localPath: "Source path",
  textPath: "Text path",
  originalPath: "Original path",
  ocr: "OCR",
};

export function humanizeKey(key: string) {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  const spaced = key.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase().replace(/\bsha 256\b/, "SHA-256").replace(/\bid\b/g, "id").replace(/\burl\b/g, "link");
}

/**
 * Turns parsed content JSON into labelled fields a person can read: strings,
 * numbers and booleans as values, long text as a block, arrays of scalars as
 * lists, arrays of arrays as small tables, objects as nested groups. Depth and
 * table size are bounded so a large workbook dump stays readable.
 */
export function readableFields(value: unknown, path = "", depth = 0): ReadableField[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const fields: ReadableField[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || raw === undefined || raw === "") continue;
    const fieldPath = path ? `${path}.${key}` : key;
    const label = humanizeKey(key);
    if (typeof raw === "string") {
      fields.push({ path: fieldPath, label, kind: raw.length > 160 || raw.includes("\n") ? "longText" : "text", value: raw });
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      fields.push({ path: fieldPath, label, kind: "text", value: typeof raw === "boolean" ? (raw ? "Yes" : "No") : String(raw) });
    } else if (Array.isArray(raw)) {
      if (!raw.length) continue;
      if (raw.every((item) => Array.isArray(item))) {
        fields.push({ path: fieldPath, label, kind: "table", rows: raw.slice(0, 40).map((row) => (row as unknown[]).slice(0, 12).map((cell) => cell == null ? "" : String(cell))) });
      } else if (raw.every((item) => item === null || typeof item !== "object")) {
        fields.push({ path: fieldPath, label, kind: "list", items: raw.map((item) => String(item ?? "")) });
      } else if (depth < 3) {
        fields.push({
          path: fieldPath,
          label,
          kind: "group",
          children: raw.slice(0, 25).flatMap((item, index): ReadableField[] => {
            if (item && typeof item === "object" && !Array.isArray(item)) return [{ path: `${fieldPath}.${index}`, label: `${label} ${index + 1}`, kind: "group" as const, children: readableFields(item, `${fieldPath}.${index}`, depth + 2) }];
            return [{ path: `${fieldPath}.${index}`, label: `${index + 1}`, kind: "text" as const, value: JSON.stringify(item) }];
          }),
        });
      }
    } else if (depth < 3) {
      const children = readableFields(raw, fieldPath, depth + 1);
      if (children.length) fields.push({ path: fieldPath, label, kind: "group", children });
    } else {
      fields.push({ path: fieldPath, label, kind: "longText", value: JSON.stringify(raw, null, 2) });
    }
  }
  return fields;
}
