/**
 * Open document category model (finding D-04).
 *
 * Categories are free text: imports, connectors and people create categories
 * Societyer did not anticipate ("Recovered source review", "Audit",
 * "Membership source review"). Nothing may hide a document because its
 * category is unknown. Known categories are matched case- and
 * punctuation-insensitively, so "financial-statement", "Financial Statement"
 * and "FinancialStatement" are one category; unknown categories keep the
 * label they were given.
 *
 * Only Societyer's own bookkeeping rows (import sessions and candidates, org
 * history scaffolding) are internal and kept out of document lists.
 */

export type DocumentCategoryTone = "accent" | "warn" | "info" | "orange" | "success" | "purple" | "neutral" | "danger";

export type KnownDocumentCategory = {
  key: string;
  label: string;
  tone: DocumentCategoryTone;
  /** Offered in the "New document" category picker. */
  pickable?: boolean;
  aliases?: string[];
  /** Offered only to these kinds of organization (all when absent). */
  entities?: readonly DocumentCategoryEntity[];
  /** Wording for a corporation, when it differs ("By-laws"). */
  corporationLabel?: string;
};

export type DocumentCategoryEntity = "society" | "corporation" | "bc_company";

/**
 * Who the category list is for: a society keeps its constitution and bylaws;
 * a corporation files articles and a certificate of incorporation (a BC
 * company has articles only, no by-laws).
 */
export type DocumentCategoryAudience = { corporation?: boolean; bcCompany?: boolean };

function audienceEntity(audience?: DocumentCategoryAudience): DocumentCategoryEntity | undefined {
  if (!audience) return undefined;
  if (audience.bcCompany) return "bc_company";
  return audience.corporation ? "corporation" : "society";
}

export const KNOWN_DOCUMENT_CATEGORIES: readonly KnownDocumentCategory[] = [
  { key: "Constitution", label: "Constitution", tone: "accent", pickable: true, entities: ["society"] },
  { key: "ArticlesOfIncorporation", label: "Articles of incorporation", tone: "accent", pickable: true, entities: ["corporation", "bc_company"], aliases: ["articles", "articles of incorporation"] },
  { key: "CertificateOfIncorporation", label: "Certificate of incorporation", tone: "accent", pickable: true, aliases: ["certificate of incorporation", "incorporation certificate"] },
  { key: "Bylaws", label: "Bylaws", corporationLabel: "By-laws", tone: "accent", pickable: true, entities: ["society", "corporation"], aliases: ["bylaw", "by-laws", "by laws"] },
  { key: "Minutes", label: "Minutes", tone: "success", pickable: true, aliases: ["meeting minutes"] },
  { key: "FinancialStatement", label: "Financial statement", tone: "warn", pickable: true, aliases: ["financial statements", "financial-statements"] },
  { key: "Policy", label: "Policy", tone: "info", pickable: true, aliases: ["policies"] },
  { key: "Filing", label: "Filing", tone: "info", pickable: true, aliases: ["filings"] },
  { key: "Agreement", label: "Agreement", tone: "orange", pickable: true, aliases: ["agreements", "contract", "contracts"] },
  { key: "Insurance", label: "Insurance", tone: "orange", pickable: true },
  { key: "Grant", label: "Grant", tone: "success", pickable: true, aliases: ["grants"] },
  { key: "Receipt", label: "Receipt", tone: "neutral", pickable: true, aliases: ["receipts"] },
  { key: "CourtOrder", label: "Court order", tone: "danger", pickable: true, aliases: ["court orders"] },
  { key: "Audit", label: "Audit", tone: "warn", pickable: true },
  { key: "Correspondence", label: "Correspondence", tone: "neutral", pickable: true },
  { key: "Library", label: "Library", tone: "info", pickable: true },
  { key: "WorkflowGenerated", label: "Workflow generated", tone: "purple", pickable: true },
  // Drafts produced by the document catalog carry the lowercase key on every runtime.
  { key: "governance", label: "Governance", tone: "accent" },
  { key: "Recovered source review", label: "Recovered source review", tone: "warn" },
  { key: "Membership source review", label: "Membership source review", tone: "warn" },
  { key: "Other", label: "Other", tone: "neutral", pickable: true },
];

/** Societyer bookkeeping rows stored in the documents table. */
export const INTERNAL_DOCUMENT_CATEGORIES = ["Import Session", "Import Candidate", "Org History Source", "Org History Item"] as const;
const INTERNAL_TAGS = ["import-session", "org-history"];

/** Case- and punctuation-insensitive comparison key. */
export function categoryMatchKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const KNOWN_BY_MATCH = new Map<string, KnownDocumentCategory>();
for (const category of KNOWN_DOCUMENT_CATEGORIES) {
  for (const name of [category.key, category.label, ...(category.aliases ?? [])]) KNOWN_BY_MATCH.set(categoryMatchKey(name), category);
}
const INTERNAL_MATCH = new Set<string>(INTERNAL_DOCUMENT_CATEGORIES.map(categoryMatchKey));

export function knownDocumentCategory(value: unknown) {
  return KNOWN_BY_MATCH.get(categoryMatchKey(value));
}

/**
 * Canonical stored/grouping value for a category: the known key when the value
 * matches a known category in any spelling, otherwise the trimmed value with
 * internal whitespace collapsed ("Other" when blank).
 */
export function normalizeDocumentCategory(value: unknown): string {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "Other";
  return knownDocumentCategory(raw)?.key ?? raw;
}

/** Grouping key that also folds unknown categories that differ only in case. */
export function documentCategoryGroupKey(value: unknown) {
  const normalized = normalizeDocumentCategory(value);
  return knownDocumentCategory(normalized) ? normalized : `custom:${categoryMatchKey(normalized)}`;
}

export function documentCategoryLabel(value: unknown, audience?: DocumentCategoryAudience) {
  const known = knownDocumentCategory(value);
  if (known) return knownCategoryLabel(known, audience);
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "Other";
  // Humanize CamelCase or kebab-case keys from imports ("MeetingPackage", "meeting-package").
  const spaced = raw.includes(" ") ? raw : raw.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function documentCategoryTone(value: unknown): DocumentCategoryTone {
  return knownDocumentCategory(value)?.tone ?? "neutral";
}

export function isInternalDocumentCategory(value: unknown) {
  return INTERNAL_MATCH.has(categoryMatchKey(value));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isInternalDocumentRecord(doc: any) {
  if (!doc) return false;
  const tags = Array.isArray(doc.tags) ? doc.tags.map(String) : [];
  return isInternalDocumentCategory(doc.category) || tags.some((tag: string) => INTERNAL_TAGS.includes(tag));
}

function knownCategoryLabel(category: KnownDocumentCategory, audience?: DocumentCategoryAudience) {
  const entity = audienceEntity(audience);
  if (category.key === "ArticlesOfIncorporation" && entity === "bc_company") return "Articles";
  if (category.corporationLabel && (entity === "corporation" || entity === "bc_company")) return category.corporationLabel;
  return category.label;
}

/**
 * Categories for a picker: the known pickable ones for this kind of
 * organization, plus any category already in use (so nothing in use is ever
 * hidden, whatever its wording).
 */
export function documentCategoryOptions(inUse: Iterable<unknown> = [], audience?: DocumentCategoryAudience) {
  const entity = audienceEntity(audience);
  const options = new Map<string, { value: string; label: string }>();
  for (const category of KNOWN_DOCUMENT_CATEGORIES) {
    if (!category.pickable || (entity && category.entities && !category.entities.includes(entity))) continue;
    options.set(documentCategoryGroupKey(category.key), { value: category.key, label: knownCategoryLabel(category, audience) });
  }
  for (const value of inUse) {
    if (isInternalDocumentCategory(value)) continue;
    const key = documentCategoryGroupKey(value);
    if (!options.has(key)) options.set(key, { value: normalizeDocumentCategory(value), label: documentCategoryLabel(value, audience) });
  }
  return [...options.values()];
}

/**
 * The profile slot a governing document fills when it is uploaded under its
 * category: articles (or the certificate they come with) and a society's
 * constitution are the formation document; bylaws are bylaws.
 */
export function governanceSlotForCategory(value: unknown, audience: DocumentCategoryAudience): "constitutionDocId" | "bylawsDocId" | undefined {
  const key = knownDocumentCategory(value)?.key;
  if (audience.corporation || audience.bcCompany) {
    if (key === "ArticlesOfIncorporation" || key === "CertificateOfIncorporation") return "constitutionDocId";
    if (key === "Bylaws" && !audience.bcCompany) return "bylawsDocId";
    return undefined;
  }
  if (key === "Constitution") return "constitutionDocId";
  if (key === "Bylaws") return "bylawsDocId";
  return undefined;
}

/** Category facet with counts, most used first; "Other" last. */
export function documentCategoryFacets(docs: Iterable<{ category?: unknown }>, audience?: DocumentCategoryAudience) {
  const facets = new Map<string, { key: string; value: string; label: string; tone: DocumentCategoryTone; count: number }>();
  for (const doc of docs) {
    const key = documentCategoryGroupKey(doc.category);
    const existing = facets.get(key);
    if (existing) existing.count += 1;
    else facets.set(key, { key, value: normalizeDocumentCategory(doc.category), label: documentCategoryLabel(doc.category, audience), tone: documentCategoryTone(doc.category), count: 1 });
  }
  return [...facets.values()].sort((a, b) =>
    Number(a.value === "Other") - Number(b.value === "Other") || b.count - a.count || a.label.localeCompare(b.label));
}
