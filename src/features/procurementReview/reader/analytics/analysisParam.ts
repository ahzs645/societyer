/** Which analytics view shows (`analysis=`), and the parameters that belong to one view, which switching views drops. */
export const ANALYSIS_PARAM = "analysis";
export const VIEW_STATE = ["metric", "year", "scope", "inspect", "rankq", "rankpage"];

/** The URL change that shows another view (the overview is the default): its own parameters start fresh. */
export const viewPatch = (view: string, first = "overview"): Record<string, string | null> => ({
  [ANALYSIS_PARAM]: view === first ? null : view,
  ...Object.fromEntries(VIEW_STATE.map((key) => [key, null])),
});
/** `market=all`: the whole market rather than "Our work" (OurWork.tsx). */
export const MARKET_PARAM = "market";
/**
 * The award analysis's commodity filter (`awardCommodity=<UNSPSC code>`),
 * named apart from a commodity page's own `commodity=`, which can sit under it.
 */
export const COMMODITY_FILTER_PARAM = "awardCommodity";
