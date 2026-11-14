/**
 * Source facts only: no AI categories or buyer-derived places. Shared by the
 * hosted (Convex) and in-browser readers, so both narrow a list the same way.
 *
 * One type filter covers both of BC Bid's eras: `currentType` also matches
 * the pre-2023 types bcBidTypeCrosswalk.ts maps to it. `historicalType` is
 * kept for the pre-2023 types with no current equivalent, and for older
 * links: one naming a crosswalked pre-2023 type reads as its current type.
 */
import { currentTypeOf } from "./bcBidTypeCrosswalk";

export const BC_FILTER_KEYS = ['currentType','industryCategory','officialRegion','historicalType','commodityCode'] as const;
export type BcBidFilterKey = typeof BC_FILTER_KEYS[number];
export type BcBidSourceFilters = Partial<Record<BcBidFilterKey, string>>;

const isFilterKey = (key: string): key is BcBidFilterKey => (BC_FILTER_KEYS as readonly string[]).includes(key);

export function bcBidSourceFilters(input: unknown): BcBidSourceFilters {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid BC Bid filters.');
  const result: BcBidSourceFilters = {};
  for (const [key,value] of Object.entries(input)) {
    if (!isFilterKey(key) || typeof value !== 'string' || value.length > 100 || /\p{Cc}/u.test(value)) throw Error('Invalid BC Bid filter.');
    if (value) result[key] = value;
  }
  if (result.commodityCode && !/^\d{8}$/.test(result.commodityCode)) throw Error('Use an eight-digit UNSPSC code.');
  // An older link's crosswalked pre-2023 type reads as the current type it belongs to.
  const mapped = currentTypeOf(result.historicalType);
  if (mapped && (!result.currentType || result.currentType === mapped)) {
    result.currentType = mapped;
    delete result.historicalType;
  }
  return result;
}

/** What a UNSPSC code covers: its digits without the zero-filled pairs (10000000 → segment 10). */
export const unspscPrefix = (code: string) => code.replace(/(?:00)+$/, '');

type Facts = {
  sourceId?: unknown; opportunityTypeGroupCode?: unknown; industryCategories?: unknown; sourceRegionPath?: unknown;
  historicalTypeReferenceId?: unknown; taxonomyReleaseId?: unknown; classificationCodes?: unknown;
};

export function matchesBcBidSourceFilters(row: {analyticsJson?: string}, filters: BcBidSourceFilters) {
  if (!Object.keys(filters).length) return true;
  let data: Facts;
  try {
    const parsed: unknown = JSON.parse(row.analyticsJson || '{}');
    if (!parsed || typeof parsed !== 'object') return false;
    data = parsed as Facts;
  } catch { return false; }
  if (data.sourceId && data.sourceId !== 'bc-bid') return false;
  if (filters.currentType && data.opportunityTypeGroupCode !== filters.currentType && currentTypeOf(data.historicalTypeReferenceId) !== filters.currentType) return false;
  if (filters.industryCategory && !(Array.isArray(data.industryCategories) && data.industryCategories.includes(filters.industryCategory))) return false;
  if (filters.officialRegion && !String(data.sourceRegionPath ?? '').includes(`|${filters.officialRegion}|`)) return false;
  if (filters.historicalType && data.historicalTypeReferenceId !== filters.historicalType) return false;
  if (filters.commodityCode) {
    // Pre-2023 notices used GSIN commodity codes, not UNSPSC.
    if (data.historicalTypeReferenceId || !String(data.taxonomyReleaseId ?? '').startsWith('taxonomy-release:UNSPSC:')) return false;
    const prefix=unspscPrefix(filters.commodityCode);
    const codes = data.classificationCodes;
    if (!prefix || !Array.isArray(codes) || !codes.some((code:unknown)=>typeof code === 'string' && code.startsWith(prefix))) return false;
  }
  return true;
}
