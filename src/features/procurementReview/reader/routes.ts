/**
 * The reader's places, all in the URL so links and the browser's Back work:
 * the list (`kind`, `status`, `q`), the analytics (`section=analytics`), a
 * buyer (`buyer=<name>`), the organisation a notice is issued for
 * (`issuedFor=<name>`) or a supplier (`supplier=<name>`), a UNSPSC commodity
 * (`commodity=<code>`), and a notice (`notice=<key>&tab=`). A buyer or a
 * commodity shows over the list or analytics, and a
 * notice opens in the side panel over whatever shows; what is under it stays
 * mounted, so returning lands on the same rows at the same scroll position.
 *
 * Opening a notice, a buyer or the analytics adds a history entry; changing
 * the list (its view, search or kind) replaces the current one. So does
 * opening another notice from under an open panel (the list, a buyer page),
 * which reads the list in place as previous and next do; a notice opened from
 * inside the panel (a related award) adds an entry. The in-page Back steps
 * back through the entries the reader added, exactly as the browser's Back
 * does, and otherwise (a pasted link) goes to the parent place. Each entry the
 * reader adds remembers the place it was opened from, so Back names where it
 * really leads: a buyer opened from a notice says the notice, not the list
 * under both.
 *
 * Closing the panel (`closeNotice`) is Back when the reader opened the
 * notice: it steps back past the notice entries to the place under them, and
 * then puts that place's current address back (the list may have been
 * filtered beside the panel). From a pasted link it replaces the entry with
 * the same address less the notice.
 */
import { createContext, useCallback, useContext, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { backLabel as placeLabelOf } from "../lib/notice";
import { COMMODITY_FILTER_PARAM, MARKET_PARAM, viewPatch } from "./analytics/analysisParam";

/** `?notice=<record key>` (the shared table keeps `record` for its side panel). */
export const NOTICE_PARAM = "notice";
/** Links from before the reader had its own param (`?record=<key>`) still open the notice. */
const LEGACY_NOTICE_PARAM = "record";
/** Normalize old bookmarks before mounting the shared table, whose inspector owns `record`/`tab`. */
export function canonicalReaderParams(params: URLSearchParams): URLSearchParams | null {
  const legacy = params.get(LEGACY_NOTICE_PARAM);
  if (!legacy || params.has(NOTICE_PARAM) || !/^(opportunity|award):/.test(legacy)) return null;
  const next = new URLSearchParams(params);
  next.set(NOTICE_PARAM, legacy); next.delete(LEGACY_NOTICE_PARAM);
  return next;
}
export const BUYER_PARAM = "buyer";
export const ISSUED_FOR_PARAM = "issuedFor";
/** A supplier's page (`supplier=<name>`): the awards it won, from whom. */
export const SUPPLIER_PARAM = "supplier";
export const SECTION_PARAM = "section";
/** A commodity's page (`commodity=<eight-digit UNSPSC code>`): its notices, buyers and suppliers. */
export const COMMODITY_PARAM = "commodity";
/** A buyer or commodity page's tab (`overview` when absent): `opportunities` or `awards`. */
export const PARTY_TAB_PARAM = "partyTab";
export type PartyField = "organization" | "issuedFor" | "supplier";
export type ReaderSection = "analytics";

/** The place under the notice panel, by precedence: an organisation, then a commodity, then the analytics or the list. */
export type ReaderPlace =
  | { layer: "party"; field: PartyField; name: string }
  | { layer: "commodity"; code: string }
  | { layer: "analytics" }
  | { layer: "list"; kind: string };

export function readerPlaces(params: URLSearchParams) {
  const notice = params.get(NOTICE_PARAM) ?? params.get(LEGACY_NOTICE_PARAM);
  const buyer = params.get(BUYER_PARAM);
  const issuedFor = params.get(ISSUED_FOR_PARAM);
  const supplier = params.get(SUPPLIER_PARAM);
  const party: { field: PartyField; name: string } | null = buyer ? { field: "organization", name: buyer }
    : issuedFor ? { field: "issuedFor", name: issuedFor }
    : supplier ? { field: "supplier", name: supplier } : null;
  const requested = params.get(COMMODITY_PARAM);
  // A hand-edited code that isn't eight digits leaves the place under it showing.
  const commodity = !party && requested && /^\d{8}$/.test(requested) ? requested : null;
  const analytics = params.get(SECTION_PARAM) === "analytics";
  return { notice, party, commodity, analytics };
}

/** A stable key per place, for its saved scroll position. */
export function placeKey(place: ReaderPlace): string {
  switch (place.layer) {
    case "party": return `party:${place.field}:${place.name}`;
    case "commodity": return `commodity:${place.code}`;
    case "analytics": return "analytics";
    case "list": return `list:${place.kind}`;
  }
}

/** History entries the reader pushed itself carry this, so Back can step back instead of guessing a parent. */
const PUSHED = "procurementReader";
/**
 * With it, the name and address of the place the entry was opened from, and
 * for a notice how many entries back the place under the panel is (0 when
 * that isn't known, a notice opened over one from a pasted link).
 */
type PushedState = { [PUSHED]: true; from: string; fromSearch: string; noticeDepth: number };
const pushedState = (state: unknown): PushedState | null => {
  const value = state as Partial<PushedState> | null;
  if (!value?.[PUSHED]) return null;
  return {
    [PUSHED]: true,
    from: typeof value.from === "string" ? value.from : "",
    fromSearch: typeof value.fromSearch === "string" ? value.fromSearch : "",
    noticeDepth: typeof value.noticeDepth === "number" && value.noticeDepth > 0 ? Math.floor(value.noticeDepth) : 0,
  };
};

/**
 * The notice panel, for the reader's navigation: `inside` is true for what
 * the panel shows (so a notice opened from it adds an entry rather than
 * replacing it), and `restore` brings a minimised panel back when its notice
 * is opened again.
 */
export const NoticePanelContext = createContext<{ inside: boolean; restore: () => void } | null>(null);

/** Where a closing panel settles once Back has stepped past its notices: the address it had less the notice. */
let settling: { from: string; search: string } | null = null;
const sameParams = (a: URLSearchParams, b: URLSearchParams) =>
  [...a.entries()].sort().join("&") === [...b.entries()].sort().join("&");

/**
 * What the place showing is called, for the Back of whatever opens over it. A
 * notice provides its title (NoticePage), a commodity its code's title
 * (CommodityPage); the list, the analytics and a buyer are named from the URL.
 */
export const ReaderPlaceTitleContext = createContext<string | null>(null);
const placeLabel = (params: URLSearchParams, title: string | null) =>
  (params.get(NOTICE_PARAM) || params.get(LEGACY_NOTICE_PARAM)) ? title || "Notice"
    : readerPlaces(params).commodity && title ? title
    : placeLabelOf({ buyer: params.get(BUYER_PARAM), issuedFor: params.get(ISSUED_FOR_PARAM), supplier: params.get(SUPPLIER_PARAM), commodity: readerPlaces(params).commodity, section: params.get(SECTION_PARAM), kind: params.get("kind") });

const patched = (params: URLSearchParams, patch: Record<string, string | null>) => {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
  // Whatever sets or clears the notice settles an old `?record=` link too.
  if (NOTICE_PARAM in patch) next.delete(LEGACY_NOTICE_PARAM);
  return next;
};
const partyPatch = (field: PartyField, name: string): Record<string, string | null> => ({
  [NOTICE_PARAM]: null, tab: null, [PARTY_TAB_PARAM]: null, [COMMODITY_PARAM]: null,
  [BUYER_PARAM]: field === "organization" ? name : null,
  [ISSUED_FOR_PARAM]: field === "issuedFor" ? name : null,
  [SUPPLIER_PARAM]: field === "supplier" ? name : null,
});
/** A commodity's page takes the place of an organisation's or a notice, as an organisation's takes a commodity's. */
const commodityPatch = (code: string): Record<string, string | null> => ({
  [NOTICE_PARAM]: null, tab: null, [PARTY_TAB_PARAM]: null,
  [BUYER_PARAM]: null, [ISSUED_FOR_PARAM]: null, [SUPPLIER_PARAM]: null,
  [COMMODITY_PARAM]: code,
});
/**
 * The award analytics' overview narrowed to a commodity, in place of the page
 * over it: the whole market's awards in it, not just "Our work", so the
 * figures follow the commodity page's.
 */
const commodityAnalyticsPatch = (code: string): Record<string, string | null> => ({
  ...commodityPatch(code), [COMMODITY_PARAM]: null,
  [SECTION_PARAM]: "analytics", ...viewPatch("overview"), [MARKET_PARAM]: "all", [COMMODITY_FILTER_PARAM]: code,
});

export function useReaderNavigation() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const title = useContext(ReaderPlaceTitleContext);
  const panel = useContext(NoticePanelContext);
  const state = pushedState(location.state);
  const pushed = Boolean(state);
  const openKey = params.get(NOTICE_PARAM) || params.get(LEGACY_NOTICE_PARAM);

  const go = useCallback((patch: Record<string, string | null>, replace = false) => {
    const next = patched(params, patch);
    // A notice opened over the place under the panel is one step from it; over another notice, one more.
    const noticeDepth = !next.get(NOTICE_PARAM) ? 0 : !openKey ? 1 : state?.noticeDepth ? state.noticeDepth + 1 : 0;
    const from: PushedState = { [PUSHED]: true, from: placeLabel(params, title), fromSearch: `?${params.toString()}`, noticeDepth };
    navigate({ search: `?${next.toString()}` }, { replace, state: replace ? location.state : from });
  }, [params, navigate, location.state, title, openKey, state?.noticeDepth]);

  /** Where Back leads when the reader didn't push the current entry (a pasted link). */
  const parentPatch = (): Record<string, string | null> =>
    params.get(NOTICE_PARAM) || params.get(LEGACY_NOTICE_PARAM) ? { [NOTICE_PARAM]: null, tab: null }
      : params.get(BUYER_PARAM) || params.get(ISSUED_FOR_PARAM) || params.get(SUPPLIER_PARAM) || params.get(COMMODITY_PARAM)
        ? { [BUYER_PARAM]: null, [ISSUED_FOR_PARAM]: null, [SUPPLIER_PARAM]: null, [COMMODITY_PARAM]: null, [PARTY_TAB_PARAM]: null }
      : { [SECTION_PARAM]: null };

  const back = useCallback(() => { if (pushed) navigate(-1); else go(parentPatch(), true); }, [pushed, navigate, go]); // eslint-disable-line react-hooks/exhaustive-deps -- parentPatch reads `params`, which `go` follows

  return {
    params,
    /** Whether Back steps back through history (the reader opened this place) rather than going to its parent. */
    pushed,
    /**
     * A notice in the panel over whatever is showing; `tab` scrolls it to a
     * section ("documents", or "review" for the decision panel). The notice
     * that is open already comes back from its dock; another one opened from
     * under the panel takes its place in the same history entry.
     */
    openNotice: useCallback((recordKey: string, tab?: "documents" | "review") => {
      if (openKey === recordKey) {
        panel?.restore();
        if (tab && params.get("tab") !== tab) go({ tab }, true);
        return;
      }
      go({ [NOTICE_PARAM]: recordKey, tab: tab ?? null }, Boolean(openKey) && !panel?.inside);
    }, [go, openKey, panel, params]),
    /** Closes the notice panel: Back to the place under it when the reader opened the notice, else the same address less the notice. */
    closeNotice: useCallback(() => {
      if (!openKey) return;
      const under = patched(params, { [NOTICE_PARAM]: null, tab: null });
      if (state?.noticeDepth) {
        settling = { from: location.key, search: under.toString() };
        navigate(-state.noticeDepth);
      } else navigate({ search: `?${under.toString()}` }, { replace: true, state: location.state });
    }, [openKey, params, state?.noticeDepth, navigate, location.key, location.state]),
    /** A buyer (or issued-for organisation) page; opened from a notice, it takes the notice's place over the list. */
    openParty: useCallback((field: PartyField, name: string) => go(partyPatch(field, name)), [go]),
    /** The href of a buyer (or issued-for organisation) page, for links. */
    partyHref: (field: PartyField, name: string) => `?${patched(params, partyPatch(field, name)).toString()}`,
    /** A commodity's page (an eight-digit UNSPSC code); opened from a notice, it takes the notice's place, as a buyer does. */
    openCommodity: useCallback((code: string) => go(commodityPatch(code)), [go]),
    /** The href of a commodity's page, for links. */
    commodityHref: (code: string) => `?${patched(params, commodityPatch(code)).toString()}`,
    /** The award analytics narrowed to a commodity (Back returns to where it was opened from). */
    openCommodityAnalytics: useCallback((code: string) => go(commodityAnalyticsPatch(code)), [go]),
    commodityAnalyticsHref: (code: string) => `?${patched(params, commodityAnalyticsPatch(code)).toString()}`,
    /** The catalog's analytics, over the list. */
    openAnalytics: useCallback(() => go({ [SECTION_PARAM]: "analytics" }), [go]),
    back,
    /** The name of the place Back leads to: the one this was opened from, or (from a pasted link) the parent. */
    backLabel: state?.from || placeLabel(patched(params, parentPatch()), null),
    /** The address Back leads to, for the link's href (a middle-click or long-press opens it in a new tab). */
    backHref: state?.fromSearch || `?${patched(params, parentPatch()).toString()}`,
    /** Change list state in place (no new history entry). */
    update: useCallback((patch: Record<string, string | null>) => go(patch, true), [go]),
  };
}

/**
 * Finishes a `closeNotice` that stepped back: once the history entry has
 * changed, puts back the address the place under the panel had when it
 * closed (a list filtered beside the panel keeps its filters), replacing the
 * entry Back landed on. ProcurementReader runs it once.
 */
export function useSettleClosedNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const pending = settling;
    if (!pending || pending.from === location.key) return;
    settling = null;
    const want = new URLSearchParams(pending.search);
    if (!sameParams(want, new URLSearchParams(location.search))) navigate({ search: `?${want.toString()}` }, { replace: true, state: location.state });
  }, [location, navigate]);
}
