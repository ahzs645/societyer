/**
 * The award analysis's filters, buyer grouping and exclusions as both the
 * server's analysis and the in-browser one read and change them: from the
 * URL, with this person's last exclusions as the default when a link has
 * none (exclusionStore.ts), written back to the URL so the page's link always
 * carries what the figures leave out.
 */
import { useCallback, useEffect, useRef } from "react";
import { useToast } from "../../../../components/Toast";
import type { Exclusion, MarketFilters } from "../../lib/market";
import { useReaderNavigation } from "../routes";
import { useRememberedExclusions } from "./exclusionStore";
import { EXCLUSION_KINDS, withExclusion, withoutExclusion } from "./exclusions";
import { BUYER_LEVEL_PARAM, DEFAULT_BUYER_LEVEL, EXCLUDE_PARAM, filterPatch, readBuyerLevel, readFilters, type BuyerLevel } from "./filters";
import { INSPECT_PARAM } from "./inspect";

const sameList = (a: Exclusion[] | undefined, b: Exclusion[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

export function useAnalysisFilters() {
  const nav = useReaderNavigation();
  const toast = useToast();
  const { remembered, remember } = useRememberedExclusions();
  const inUrl = nav.params.has(EXCLUDE_PARAM);
  const read = readFilters(nav.params);
  const filters: MarketFilters = inUrl || !remembered.length ? read : { ...read, exclude: remembered };
  const buyerLevel = readBuyerLevel(nav.params);
  const { update } = nav;

  // A link without exclusions takes this person's last ones, and says so in the URL. Only as the
  // analysis opens: later, the URL and this browser change together (setFilters), and syncing
  // again mid-change would write an older URL back over the new one.
  const rememberedJson = remembered.length ? JSON.stringify(remembered) : "";
  useEffect(() => {
    if (!inUrl && rememberedJson) update({ [EXCLUDE_PARAM]: rememberedJson });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, as the analysis opens

  const latest = useRef(filters);
  latest.current = filters;
  /**
   * New filters, and with `buyerLevel` a new grouping, in one change to the
   * URL (two changes in a row would each start from the same old URL). An
   * open drill-down closes unless `keepInspection`.
   */
  const setFilters = useCallback((next: MarketFilters, options: { keepInspection?: boolean; buyerLevel?: BuyerLevel } = {}) => {
    if (!sameList(next.exclude, latest.current.exclude)) remember(next.exclude ?? []);
    update({
      ...filterPatch(next),
      ...(options.buyerLevel ? { [BUYER_LEVEL_PARAM]: options.buyerLevel === DEFAULT_BUYER_LEVEL ? null : options.buyerLevel } : {}),
      ...(options.keepInspection ? {} : { [INSPECT_PARAM]: null }),
      rankpage: null,
    });
  }, [remember, update]);
  const setBuyerLevel = useCallback((level: BuyerLevel) => setFilters(latest.current, { buyerLevel: level }), [setFilters]);
  const setExclusions = useCallback((list: Exclusion[], keepInspection = true) => {
    const { exclude: _replaced, ...rest } = latest.current;
    setFilters(list.length ? { ...rest, exclude: list } : rest, { keepInspection });
  }, [setFilters]);
  /**
   * Leaves one out, with a way back. An open drill-down stays open (its rows
   * refresh) unless `closeInspection`, done in the same step.
   */
  const exclude = useCallback((item: Exclusion, closeInspection = false) => {
    setExclusions(withExclusion(latest.current.exclude, item), !closeInspection);
    toast.success(`Excluded ${item.name}`, {
      description: `${EXCLUSION_KINDS[item.field]} left out of the analysis.`,
      action: { label: "Undo", onClick: () => setExclusions(withoutExclusion(latest.current.exclude, item)) },
    });
  }, [setExclusions, toast]);
  return { nav, filters, buyerLevel, setFilters, setBuyerLevel, setExclusions, exclude };
}
