/** Source facts only: no AI categories or buyer-derived places. Shared by hosted and snapshot readers. */
export const BC_FILTER_KEYS = ['currentType','industryCategory','officialRegion','historicalType','commodityCode'] as const;
export type BcBidSourceFilters = Partial<Record<typeof BC_FILTER_KEYS[number], string>>;
export function bcBidSourceFilters(input: unknown): BcBidSourceFilters {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid BC Bid filters.');
  const result: BcBidSourceFilters = {};
  for (const [key,value] of Object.entries(input)) {
    if (!BC_FILTER_KEYS.includes(key as any) || typeof value !== 'string' || value.length > 100 || /\p{Cc}/u.test(value)) throw Error('Invalid BC Bid filter.');
    if (value) result[key as keyof BcBidSourceFilters] = value;
  }
  if (result.commodityCode && !/^\d{8}$/.test(result.commodityCode)) throw Error('Use an eight-digit UNSPSC code.');
  return result;
}
export function matchesBcBidSourceFilters(row: {analyticsJson?: string}, filters: BcBidSourceFilters) {
  if (!Object.keys(filters).length) return true;
  let data: any; try { data=JSON.parse(row.analyticsJson || '{}'); } catch { return false; }
  if (data.sourceId && data.sourceId !== 'bc-bid') return false;
  if (filters.currentType && data.opportunityTypeGroupCode !== filters.currentType) return false;
  if (filters.industryCategory && !data.industryCategories?.includes(filters.industryCategory)) return false;
  if (filters.officialRegion && !String(data.sourceRegionPath ?? '').includes(`|${filters.officialRegion}|`)) return false;
  if (filters.historicalType && data.historicalTypeReferenceId !== filters.historicalType) return false;
  if (filters.commodityCode) {
    if (data.historicalTypeReferenceId || !String(data.taxonomyReleaseId ?? '').startsWith('taxonomy-release:UNSPSC:')) return false;
    // UNSPSC hierarchy uses zero-filled pairs: 10000000 -> segment 10.
    const prefix=filters.commodityCode.replace(/(?:00)+$/, '');
    if (!prefix || !Array.isArray(data.classificationCodes) || !data.classificationCodes.some((code:unknown)=>typeof code === 'string' && code.startsWith(prefix))) return false;
  }
  return true;
}
