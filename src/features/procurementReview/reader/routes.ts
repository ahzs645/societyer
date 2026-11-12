/**
 * The reader's places, all in the URL so links and the browser's Back work:
 * the list (`kind`, `status`, `q`), the analytics (`section=analytics`), a
 * buyer (`buyer=<name>`) or the organisation a notice is issued for
 * (`issuedFor=<name>`), and a notice (`notice=<key>&tab=`). A notice shows
 * over a buyer, a buyer over the list or analytics; what is under it stays
 * mounted, so returning lands on the same rows at the same scroll position.
 *
 * Opening a notice, a buyer or the analytics adds a history entry; changing
 * the list (its view, search or kind) replaces the current one. The in-page
 * Back steps back through the entries the reader added, exactly as the
 * browser's Back does, and otherwise (a pasted link) goes to the parent place.
 * Each entry the reader adds remembers the place it was opened from, so Back
 * names where it really leads: a buyer opened from a notice says the notice,
 * not the list under both.
 */
import { createContext, useCallback, useContext } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { backLabel as placeLabelOf } from "../lib/notice";

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
export const SECTION_PARAM = "section";
/** A buyer page's tab (`overview` when absent): `opportunities` or `awards`. */
export const PARTY_TAB_PARAM = "partyTab";
export type PartyField = "organization" | "issuedFor";
export type ReaderSection = "analytics";

/** Which place shows, by precedence: a notice, then a buyer or issued-for organisation, then the analytics or the list. */
export type ReaderPlace =
  | { layer: "notice"; recordKey: string }
  | { layer: "party"; field: PartyField; name: string }
  | { layer: "analytics" }
  | { layer: "list"; kind: string };

export function readerPlaces(params: URLSearchParams) {
  const notice = params.get(NOTICE_PARAM) ?? params.get(LEGACY_NOTICE_PARAM);
  const buyer = params.get(BUYER_PARAM);
  const issuedFor = params.get(ISSUED_FOR_PARAM);
  const party = buyer ? { field: "organization" as const, name: buyer } : issuedFor ? { field: "issuedFor" as const, name: issuedFor } : null;
  const analytics = params.get(SECTION_PARAM) === "analytics";
  return { notice, party, analytics };
}

/** A stable key per place, for its saved scroll position. */
export function placeKey(place: ReaderPlace): string {
  switch (place.layer) {
    case "notice": return `notice:${place.recordKey}`;
    case "party": return `party:${place.field}:${place.name}`;
    case "analytics": return "analytics";
    case "list": return `list:${place.kind}`;
  }
}

/** History entries the reader pushed itself carry this, so Back can step back instead of guessing a parent. */
const PUSHED = "procurementReader";
/** With it, the name and address of the place the entry was opened from. */
type PushedState = { [PUSHED]: true; from: string; fromSearch: string };
const pushedState = (state: unknown): PushedState | null => {
  const value = state as Partial<PushedState> | null;
  return value?.[PUSHED] ? { [PUSHED]: true, from: typeof value.from === "string" ? value.from : "", fromSearch: typeof value.fromSearch === "string" ? value.fromSearch : "" } : null;
};

/**
 * What the place showing is called, for the Back of whatever opens over it. A
 * notice provides its title (NoticePage); the list, the analytics and a buyer
 * are named from the URL.
 */
export const ReaderPlaceTitleContext = createContext<string | null>(null);
const placeLabel = (params: URLSearchParams, title: string | null) =>
  (params.get(NOTICE_PARAM) || params.get(LEGACY_NOTICE_PARAM)) ? title || "Notice"
    : placeLabelOf({ buyer: params.get(BUYER_PARAM), issuedFor: params.get(ISSUED_FOR_PARAM), section: params.get(SECTION_PARAM), kind: params.get("kind") });

const patched = (params: URLSearchParams, patch: Record<string, string | null>) => {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
  // Whatever sets or clears the notice settles an old `?record=` link too.
  if (NOTICE_PARAM in patch) next.delete(LEGACY_NOTICE_PARAM);
  return next;
};
const partyPatch = (field: PartyField, name: string): Record<string, string | null> => ({
  [NOTICE_PARAM]: null, tab: null, [PARTY_TAB_PARAM]: null,
  [BUYER_PARAM]: field === "organization" ? name : null,
  [ISSUED_FOR_PARAM]: field === "issuedFor" ? name : null,
});

export function useReaderNavigation() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const title = useContext(ReaderPlaceTitleContext);
  const state = pushedState(location.state);
  const pushed = Boolean(state);

  const go = useCallback((patch: Record<string, string | null>, replace = false) => {
    const from: PushedState = { [PUSHED]: true, from: placeLabel(params, title), fromSearch: `?${params.toString()}` };
    navigate({ search: `?${patched(params, patch).toString()}` }, { replace, state: replace ? location.state : from });
  }, [params, navigate, location.state, title]);

  /** Where Back leads when the reader didn't push the current entry (a pasted link). */
  const parentPatch = (): Record<string, string | null> =>
    params.get(NOTICE_PARAM) || params.get(LEGACY_NOTICE_PARAM) ? { [NOTICE_PARAM]: null, tab: null }
      : params.get(BUYER_PARAM) || params.get(ISSUED_FOR_PARAM) ? { [BUYER_PARAM]: null, [ISSUED_FOR_PARAM]: null, [PARTY_TAB_PARAM]: null }
      : { [SECTION_PARAM]: null };

  const back = useCallback(() => { if (pushed) navigate(-1); else go(parentPatch(), true); }, [pushed, navigate, go]); // eslint-disable-line react-hooks/exhaustive-deps -- parentPatch reads `params`, which `go` follows

  return {
    params,
    /** Whether Back steps back through history (the reader opened this place) rather than going to its parent. */
    pushed,
    /** A notice over whatever is showing; `tab` opens one of its tabs ("documents", "review"). */
    openNotice: useCallback((recordKey: string, tab?: "documents" | "review") => go({ [NOTICE_PARAM]: recordKey, tab: tab ?? null }), [go]),
    /** A buyer (or issued-for organisation) page; opened from a notice, it takes the notice's place over the list. */
    openParty: useCallback((field: PartyField, name: string) => go(partyPatch(field, name)), [go]),
    /** The href of a buyer (or issued-for organisation) page, for links. */
    partyHref: (field: PartyField, name: string) => `?${patched(params, partyPatch(field, name)).toString()}`,
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
