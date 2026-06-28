/**
 * Pure parsers that turn an RSS or JSON grant feed into normalized opportunity
 * records. Dependency-free (regex for RSS, JSON.parse handled by the caller) so
 * they run inside a Convex action and are unit-testable in plain Node. HTML
 * sources that need a DOM/CSS-selector engine are NOT handled here — the caller
 * reports those as unsupported server-side.
 */

export type DiscoveredOpportunity = {
  title: string;
  funder?: string;
  program?: string;
  opportunityUrl?: string;
  applicationDueDate?: string;
  amountText?: string;
  eligibilityText?: string;
  description?: string;
  /** Stable id for dedupe within a source (guid / link / title fallback). */
  externalId: string;
};

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "") // strip any residual tags from descriptions
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!m) return undefined;
  const v = decodeEntities(m[1]);
  return v || undefined;
}

/** Parse an RSS/Atom-ish feed into opportunities (one per <item> or <entry>). */
export function parseRssOpportunities(xml: string): DiscoveredOpportunity[] {
  const text = String(xml ?? "");
  const blocks = text.match(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi) ?? [];
  const out: DiscoveredOpportunity[] = [];
  for (const block of blocks) {
    const title = tagValue(block, "title");
    if (!title) continue;
    // <link> may be an element value (RSS) or an href attribute (Atom).
    let link = tagValue(block, "link");
    if (!link) {
      const href = /<link[^>]*href=["']([^"']+)["']/i.exec(block);
      link = href ? href[1] : undefined;
    }
    const description = tagValue(block, "description") ?? tagValue(block, "summary");
    const pubDate = tagValue(block, "pubDate") ?? tagValue(block, "updated") ?? tagValue(block, "published");
    const guid = tagValue(block, "guid") ?? tagValue(block, "id");
    out.push({
      title,
      opportunityUrl: link,
      description,
      applicationDueDate: pubDate,
      externalId: guid || link || title,
    });
  }
  return out;
}

const FIELD_ALIASES: Record<keyof Omit<DiscoveredOpportunity, "externalId">, string[]> = {
  title: ["title", "name", "opportunityTitle", "programTitle"],
  funder: ["funder", "funderName", "organization", "fundingOrganization", "sponsor"],
  program: ["program", "programName", "programme"],
  opportunityUrl: ["opportunityUrl", "url", "link", "applicationUrl", "detailUrl", "permalink"],
  applicationDueDate: ["applicationDueDate", "applicationDeadline", "deadline", "dueDate", "closeDate", "closingDate"],
  amountText: ["amountText", "amount", "award", "value", "funding"],
  eligibilityText: ["eligibilityText", "eligibility", "eligibilityCriteria", "whoCanApply"],
  description: ["description", "summary", "abstract", "details"],
};

function pick(item: any, keys: string[], mapping?: string): string | undefined {
  if (mapping && item[mapping] != null && String(item[mapping]).trim()) return String(item[mapping]).trim();
  for (const k of keys) {
    if (item[k] != null && String(item[k]).trim()) return String(item[k]).trim();
  }
  return undefined;
}

/** Resolve the array of items from a parsed JSON feed, trying a caller-supplied
 *  path first, then common envelope keys, then the top-level value. */
export function resolveJsonItems(json: any, listPath?: string): any[] {
  if (listPath) {
    const node = listPath.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), json);
    if (Array.isArray(node)) return node;
  }
  if (Array.isArray(json)) return json;
  for (const k of ["items", "data", "results", "opportunities", "records", "value"]) {
    if (Array.isArray(json?.[k])) return json[k];
  }
  return [];
}

/** Map parsed JSON feed items into opportunities. `mappings` optionally overrides
 *  which source key feeds each field. */
export function parseJsonFeedOpportunities(
  json: any,
  mappings?: Partial<Record<keyof DiscoveredOpportunity, string>>,
  listPath?: string,
): DiscoveredOpportunity[] {
  const items = resolveJsonItems(json, listPath);
  const out: DiscoveredOpportunity[] = [];
  for (const item of items) {
    if (item == null || typeof item !== "object") continue;
    const title = pick(item, FIELD_ALIASES.title, mappings?.title);
    if (!title) continue;
    const opportunityUrl = pick(item, FIELD_ALIASES.opportunityUrl, mappings?.opportunityUrl);
    const externalId =
      (item.id != null && String(item.id)) ||
      (item.guid != null && String(item.guid)) ||
      opportunityUrl ||
      title;
    out.push({
      title,
      funder: pick(item, FIELD_ALIASES.funder, mappings?.funder),
      program: pick(item, FIELD_ALIASES.program, mappings?.program),
      opportunityUrl,
      applicationDueDate: pick(item, FIELD_ALIASES.applicationDueDate, mappings?.applicationDueDate),
      amountText: pick(item, FIELD_ALIASES.amountText, mappings?.amountText),
      eligibilityText: pick(item, FIELD_ALIASES.eligibilityText, mappings?.eligibilityText),
      description: pick(item, FIELD_ALIASES.description, mappings?.description),
      externalId: String(externalId),
    });
  }
  return out;
}
