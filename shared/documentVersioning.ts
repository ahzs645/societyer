/**
 * Document duplicates and version groups (finding D-14, schema A8).
 *
 * Two relations, kept apart on purpose:
 *  - exact duplicates: the same bytes (SHA-256) or the same source file (an
 *    external id such as a Drive file id, compared case-insensitively), or an
 *    explicit `duplicateOfDocumentId` link. One copy is canonical; the others
 *    are marked as duplicates and can be merged into it.
 *  - versions: different files that are versions of one record — a DRAFT and
 *    an APPROVED copy of the same minutes, "Balance Sheet Dec 31, 2024" and its
 *    "(Revised)" copy. Grouped by an explicit `versionGroupKey`, else by the
 *    file name with version words removed. Dates stay in the key, so minutes of
 *    different meetings never group.
 *
 * Pure: no ctx, no runtime. Used by the portable handlers, the UI and the gate.
 */

export const SOURCE_VERSION_STATUSES = ["draft", "final", "approved", "signed", "revised"] as const;
export type SourceVersionStatus = (typeof SOURCE_VERSION_STATUSES)[number];

export function isSourceVersionStatus(value: unknown): value is SourceVersionStatus {
  return SOURCE_VERSION_STATUSES.includes(value as SourceVersionStatus);
}

export function normalizeSourceVersionStatus(value: unknown): SourceVersionStatus | undefined {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key) return undefined;
  if (isSourceVersionStatus(key)) return key;
  if (/^(executed|countersigned)$/.test(key)) return "signed";
  if (/^(adopted|ratified|accepted)$/.test(key)) return "approved";
  if (/^(amended|revision|rev)$/.test(key)) return "revised";
  if (/^(working|wip|proposed)$/.test(key)) return "draft";
  return undefined;
}

export const SOURCE_VERSION_STATUS_LABELS: Record<SourceVersionStatus, string> = {
  draft: "Draft",
  final: "Final",
  approved: "Approved",
  signed: "Signed",
  revised: "Revised",
};

/**
 * Reads the version status a source file states about itself in its title or
 * file name. "Final draft" is a draft; "Signed" outranks "Approved".
 */
export function detectSourceVersionStatus(...texts: unknown[]): SourceVersionStatus | undefined {
  const text = texts.map((value) => String(value ?? "")).join(" ").replace(/[_]+/g, " ");
  if (!text.trim()) return undefined;
  if (/\b(signed|executed|countersigned)\b/i.test(text) && !/\bunsigned\b/i.test(text)) return "signed";
  if (/\b(approved|adopted|ratified)\b/i.test(text) && !/\b(un|not )approved\b/i.test(text)) return "approved";
  if (/\b(revised|amended|revision|rev\.?\s*\d+)\b/i.test(text)) return "revised";
  if (/\bdraft\b/i.test(text)) return "draft";
  if (/\bfinal\b/i.test(text)) return "final";
  return undefined;
}

const VERSION_WORDS = /\b(draft|final|approved|adopted|signed|unsigned|executed|revised|amended|revision|rev\s*\d{0,2}|v\s?\d{1,2}|ver\s*\d{1,2}|version\s*\d{1,2}|copy\s+of|copy|clean|redline|tracked|updated|scan(ned)?|for\s+approval|for\s+review)\b/g;
const FILE_EXTENSION = /\.(pdf|docx?|xlsx?|xlsm|csv|txt|rtf|odt|ods|pptx?|pages|numbers|key|msg|eml|jpe?g|png|gif|tiff?|html?|md|json|zip)$/i;

/**
 * Comparison key for "likely versions": lowercased name without extension,
 * version words, copy counters ("(1)") or punctuation. Returns undefined when
 * the rest is too generic to group on (one short token such as "minutes" or an
 * invoice number).
 */
export function versionNameKey(name: unknown): string | undefined {
  let text = String(name ?? "").trim();
  if (!text) return undefined;
  text = text.replace(FILE_EXTENSION, "");
  text = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(\s*\d+\s*\)/g, " ")
    .replace(/[_\-–—.,;:()[\]{}'"#&+]+/g, " ");
  text = text.replace(VERSION_WORDS, " ").replace(/\s+/g, " ").trim();
  const tokens = text.split(" ").filter(Boolean);
  const letters = tokens.filter((token) => /[a-z]/.test(token));
  if (tokens.length < 2 || letters.length < 1 || text.replace(/\s/g, "").length < 6) return undefined;
  return tokens.join(" ");
}

export function normalizeExternalId(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text.toLowerCase() : "";
}

export type VersionableDocument = {
  _id: string;
  title?: string;
  fileName?: string;
  createdAtISO?: string;
  archivedAtISO?: string;
  sha256?: string;
  externalIds?: string[];
  versionGroupKey?: string;
  duplicateOfDocumentId?: string;
  supersedesDocumentId?: string;
  sourceVersionStatus?: string;
  sourceDate?: string;
};

export type DocumentGroupInfo = {
  /** Exact-duplicate group (same bytes or same source file); undefined when unique. */
  duplicateKey?: string;
  duplicateCount: number;
  canonicalId?: string;
  isDuplicate: boolean;
  /** Why the copies are duplicates. */
  duplicateReason?: "sha256" | "source" | "marked";
  /** Version group (distinct files that are versions of one record). */
  versionKey?: string;
  versionCount: number;
  versionKeySource?: "explicit" | "name";
  sourceVersionStatus?: SourceVersionStatus;
  sourceVersionStatusDetected?: boolean;
  supersededById?: string;
};

class UnionFind {
  private parent = new Map<string, string>();
  find(id: string): string {
    let root = id;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    let node = id;
    while (node !== root) {
      const next = this.parent.get(node) ?? root;
      this.parent.set(node, root);
      node = next;
    }
    if (!this.parent.has(root)) this.parent.set(root, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra);
  }
}

function canonicalOrder(a: VersionableDocument, b: VersionableDocument) {
  return Number(Boolean(a.duplicateOfDocumentId)) - Number(Boolean(b.duplicateOfDocumentId))
    || Number(Boolean(a.archivedAtISO)) - Number(Boolean(b.archivedAtISO))
    || Number(!a.fileName) - Number(!b.fileName)
    || String(a.createdAtISO ?? "").localeCompare(String(b.createdAtISO ?? ""))
    || a._id.localeCompare(b._id);
}

/**
 * Groups documents into exact-duplicate sets and version groups. A document
 * whose `versionGroupKey` is set never falls back to name matching, so a person
 * can separate a wrongly grouped file by giving it its own key.
 */
export function buildDocumentGroups(docs: VersionableDocument[]): Map<string, DocumentGroupInfo> {
  const byId = new Map(docs.map((doc) => [doc._id, doc]));
  const exact = new UnionFind();
  const reasons = new Map<string, DocumentGroupInfo["duplicateReason"]>();
  const firstBy = new Map<string, string>();
  const link = (key: string, id: string, reason: DocumentGroupInfo["duplicateReason"]) => {
    const first = firstBy.get(key);
    if (!first) { firstBy.set(key, id); return; }
    exact.union(first, id);
    reasons.set(id, reasons.get(id) ?? reason);
    reasons.set(first, reasons.get(first) ?? reason);
  };
  for (const doc of docs) {
    exact.find(doc._id);
    const sha = String(doc.sha256 ?? "").trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(sha) && sha !== EMPTY_SHA256) link(`sha:${sha}`, doc._id, "sha256");
    for (const externalId of doc.externalIds ?? []) {
      const key = normalizeExternalId(externalId);
      if (key && key.includes(":")) link(`ext:${key}`, doc._id, "source");
    }
  }
  for (const doc of docs) {
    if (doc.duplicateOfDocumentId && byId.has(doc.duplicateOfDocumentId)) {
      exact.union(doc._id, doc.duplicateOfDocumentId);
      reasons.set(doc._id, reasons.get(doc._id) ?? "marked");
    }
  }
  const exactMembers = new Map<string, VersionableDocument[]>();
  for (const doc of docs) {
    const root = exact.find(doc._id);
    const list = exactMembers.get(root) ?? [];
    list.push(doc);
    exactMembers.set(root, list);
  }

  // Version groups over exact groups (a duplicate set counts once).
  const versionOf = new Map<string, { key: string; source: "explicit" | "name" }>();
  for (const members of exactMembers.values()) {
    const explicit = members.map((doc) => doc.versionGroupKey?.trim()).find(Boolean);
    if (explicit) {
      for (const doc of members) versionOf.set(doc._id, { key: `explicit:${explicit.toLowerCase()}`, source: "explicit" });
      continue;
    }
    const nameKey = members.map((doc) => versionNameKey(doc.fileName || doc.title)).find(Boolean);
    if (nameKey) for (const doc of members) versionOf.set(doc._id, { key: `name:${nameKey}`, source: "name" });
  }
  const versionGroups = new Map<string, Set<string>>();
  for (const [id, version] of versionOf) {
    const root = exact.find(id);
    const set = versionGroups.get(version.key) ?? new Set<string>();
    set.add(root);
    versionGroups.set(version.key, set);
  }
  const supersededBy = new Map<string, string>();
  for (const doc of docs) if (doc.supersedesDocumentId && byId.has(doc.supersedesDocumentId)) supersededBy.set(doc.supersedesDocumentId, doc._id);

  const result = new Map<string, DocumentGroupInfo>();
  for (const members of exactMembers.values()) {
    const sorted = members.slice().sort(canonicalOrder);
    const canonical = sorted[0];
    const duplicated = members.length > 1;
    for (const doc of members) {
      const version = versionOf.get(doc._id);
      const versionCount = version ? versionGroups.get(version.key)?.size ?? 1 : 1;
      const explicitStatus = normalizeSourceVersionStatus(doc.sourceVersionStatus);
      const detectedStatus = explicitStatus ? undefined : detectSourceVersionStatus(doc.fileName, doc.title);
      result.set(doc._id, {
        duplicateKey: duplicated ? `dup:${canonical._id}` : undefined,
        duplicateCount: members.length,
        canonicalId: duplicated ? canonical._id : undefined,
        isDuplicate: duplicated && doc._id !== canonical._id,
        duplicateReason: duplicated ? reasons.get(doc._id) ?? reasons.get(canonical._id) : undefined,
        versionKey: version && (versionCount > 1 || version.source === "explicit") ? version.key : undefined,
        versionCount: version ? versionCount : 1,
        versionKeySource: version?.source,
        sourceVersionStatus: explicitStatus ?? detectedStatus,
        sourceVersionStatusDetected: !explicitStatus && Boolean(detectedStatus),
        supersededById: supersededBy.get(doc._id),
      });
    }
  }
  return result;
}

/** SHA-256 of zero bytes: failed downloads share it, so it never means "duplicate". */
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Ordering inside a version panel: oldest source first, then by status rank. */
const STATUS_RANK: Record<SourceVersionStatus, number> = { draft: 0, revised: 1, final: 2, approved: 3, signed: 4 };
export function compareVersions(a: { sourceDate?: string; sourceVersionStatus?: string; createdAtISO?: string; _id: string }, b: typeof a) {
  return String(a.sourceDate ?? "").localeCompare(String(b.sourceDate ?? ""))
    || (STATUS_RANK[normalizeSourceVersionStatus(a.sourceVersionStatus) ?? "draft"] - STATUS_RANK[normalizeSourceVersionStatus(b.sourceVersionStatus) ?? "draft"])
    || String(a.createdAtISO ?? "").localeCompare(String(b.createdAtISO ?? ""))
    || a._id.localeCompare(b._id);
}
