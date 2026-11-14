/**
 * The reader inside a page, in layers (routes.ts): the list or the analytics,
 * a buyer over them, a notice over that. A covered layer stays mounted but
 * hidden, so its loaded rows and table state (filters, sort, page) survive,
 * and each place's scroll position in the `.page` scroller is saved and put
 * back, so Back lands on the same rows. Opening a notice starts at its top.
 * The module header shows over the list and the analytics only; a buyer and
 * a notice bring their own.
 *
 * On a wide screen (SPLIT_QUERY) a notice opened from the list doesn't cover
 * it: the list stays on the left, narrowed to one column with the open
 * notice's row marked, and the notice reads on the right, so a reviewer can
 * work down the queue. The notice pane is a size container
 * (`.procurement-split__notice`), and the notice page lays itself out by its
 * width. A notice over a buyer, a supplier or the analytics still covers what
 * is under it, as everything does on narrower screens.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { Tabs } from "../../../components/primitives";
import { CatalogBrowser } from "./CatalogBrowser";
import { BuyerPage } from "./BuyerPage";
import { NoticePage } from "./NoticePage";
import { ProcurementAnalytics } from "./analytics/ProcurementAnalytics";
import type { NoticeKind } from "./NoticeTable";
import { NOTICE_PARAM, SECTION_PARAM, canonicalReaderParams, placeKey, readerPlaces, useReaderNavigation, type ReaderPlace } from "./routes";
import { ReaderSourceContext, type ReaderSource } from "./source";
import { ReaderTriageContext, type ReaderTriage } from "./triage";
import { ListOrderContext, createListOrderStore } from "./listOrder";
import { useMediaQuery } from "../../../lib/useSheetDrag";
import { SplitViewContext } from "./splitView";

/** Reference data (taxonomy terms and the like) is published too, but isn't something a reviewer browses. */
const KINDS: { id: NoticeKind; label: string }[] = [
  { id: "opportunity", label: "Opportunities" },
  { id: "award", label: "Awards" },
];
const ANALYTICS = "analytics";
/** Wide enough for the list (about 420px) beside a notice of about 800px. */
const SPLIT_QUERY = "(min-width: 1280px)";

/** `triage` is the workspace's bid triage, where it has one (the hosted readers). */
export function ProcurementReader({ source, header, triage = null }: { source: ReaderSource; header: ReactNode; triage?: ReaderTriage | null }) {
  const location = useLocation();
  const [listOrder] = useState(createListOrderStore);
  const canonical = canonicalReaderParams(new URLSearchParams(location.search));
  if (canonical) return <Navigate to={{ pathname: location.pathname, search: `?${canonical.toString()}` }} replace state={location.state} />;
  return (
    <ReaderSourceContext.Provider value={source}>
      <ReaderTriageContext.Provider value={triage}>
        <ListOrderContext.Provider value={listOrder}>
          <ReaderLayers source={source} header={header} />
        </ListOrderContext.Provider>
      </ReaderTriageContext.Provider>
    </ReaderSourceContext.Provider>
  );
}

function ReaderLayers({ source, header }: { source: ReaderSource; header: ReactNode }) {
  const nav = useReaderNavigation();
  const { params, update } = nav;
  const { notice, party, analytics } = readerPlaces(params);
  const kinds = KINDS.filter((kind) => (source.catalog.counts[kind.id] ?? 0) > 0);
  const kind: NoticeKind = kinds.find((item) => item.id === params.get("kind"))?.id ?? kinds[0]?.id ?? "opportunity";
  const place: ReaderPlace = notice ? { layer: "notice", recordKey: notice }
    : party ? { layer: "party", ...party }
    : analytics ? { layer: "analytics" } : { layer: "list", kind };
  const wide = useMediaQuery(SPLIT_QUERY);
  const split = wide && Boolean(notice) && !party && !analytics;
  const covered = (place.layer === "notice" || place.layer === "party") && !split;
  const marker = useScrollMemory(placeKey(place), place.layer === "notice", split ? placeKey({ layer: "list", kind }) : null);
  const frame = useSplitFrame(split);

  const chooseTab = (id: string) => {
    // Beside an open notice, another tab replaces the notice too: it belongs to the list it was opened from.
    const closing: Record<string, string | null> = split ? { [NOTICE_PARAM]: null, tab: null } : {};
    if (id === ANALYTICS) {
      if (split) update({ ...closing, [SECTION_PARAM]: ANALYTICS });
      else if (!analytics) nav.openAnalytics();
      return;
    }
    // Back from the analytics to the list it opened over, or a list of another kind in place.
    if (analytics && nav.pushed && id === kind) { nav.back(); return; }
    if (split && id === kind) { update(closing); return; }
    update({ ...closing, section: null, kind: id === "opportunity" ? null : id, status: null, q: null });
  };

  return (
    <div ref={frame} className={split ? "procurement-split is-split" : "procurement-split"}>
      <span ref={marker} hidden />
      <Layer covered={covered} className="procurement-split__list">
        {header}
        <Tabs
          value={analytics ? ANALYTICS : kind}
          onChange={chooseTab}
          items={[
            ...kinds.map((item) => ({ id: item.id, label: item.label, count: source.catalog.counts[item.id] })),
            { id: ANALYTICS, label: "Analytics", icon: <BarChart3 size={14} aria-hidden="true" /> },
          ]}
          tabRoles
          ariaLabel="Catalog"
        />
        {/* The list stays mounted under the analytics too, so going back keeps its rows and place. */}
        <Layer covered={analytics}>
          <SplitViewContext.Provider value={split}><CatalogBrowser key={kind} kind={kind} /></SplitViewContext.Provider>
        </Layer>
        {analytics && <ProcurementAnalytics />}
      </Layer>
      {party && (
        <Layer covered={Boolean(notice)}>
          <BuyerPage key={`${party.field}:${party.name}`} field={party.field} name={party.name} />
        </Layer>
      )}
      {notice && (
        <div className="procurement-split__notice">
          <NoticePage key={notice} recordKey={notice} />
        </div>
      )}
    </div>
  );
}

/**
 * The split view's list column stays in sight while the notice beside it
 * scrolls the page: it sticks to the top of the `.page` scroller and is as
 * tall as the scroller shows (`--procurement-split-top`/`-height`).
 */
function useSplitFrame(split: boolean) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current;
    const scroller = element?.closest<HTMLElement>(".page");
    if (!split || !element || !scroller) return;
    const measure = () => {
      const style = getComputedStyle(scroller);
      const top = parseFloat(style.paddingTop) || 0;
      const bottom = parseFloat(style.paddingBottom) || 0;
      element.style.setProperty("--procurement-split-top", `${top}px`);
      element.style.setProperty("--procurement-split-height", `${Math.max(320, scroller.clientHeight - top - bottom)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => {
      observer.disconnect();
      element.style.removeProperty("--procurement-split-top");
      element.style.removeProperty("--procurement-split-height");
    };
  }, [split]);
  return frame;
}

/**
 * A place another one covers: still mounted and laid out (collapsed and out of
 * sight rather than `display: none`, which would throw away its scrollers'
 * positions), and out of the accessibility tree and the tab order.
 */
function Layer({ covered, className, children }: { covered: boolean; className?: string; children: ReactNode }) {
  const classes = ["procurement-reader__layer", className, covered && "is-covered"].filter(Boolean).join(" ");
  return <div className={classes} aria-hidden={covered || undefined}>{children}</div>;
}

/**
 * Saves the scroll positions of the place showing (the `.page` and any
 * scroller inside it, such as a table's own), and puts a place's back when it
 * shows again: the top for a place not seen before, and always for a notice.
 * In the split view the list beside the notice scrolls on its own; its
 * positions belong to the list (`listKey`), so closing the notice keeps the
 * list where the reader left it.
 */
function useScrollMemory(key: string, top: boolean, listKey: string | null) {
  const marker = useRef<HTMLSpanElement>(null);
  const positions = useRef(new Map<string, Map<Element, number>>());
  const current = useRef(key);
  const splitList = useRef(listKey);
  splitList.current = listKey;
  useLayoutEffect(() => {
    const scroller = marker.current?.closest(".page");
    if (!scroller) return;
    // Scroll events don't bubble; listening in the capture phase hears every scroller under the page.
    const record = (event: Event) => {
      const target = event.target === document ? scroller : event.target;
      if (!(target instanceof Element) || !scroller.contains(target) || !target.isConnected || target.closest(".is-covered")) return;
      const owner = splitList.current && target !== scroller && target.closest(".procurement-split__list") ? splitList.current : current.current;
      let saved = positions.current.get(owner);
      if (!saved) positions.current.set(owner, saved = new Map());
      saved.set(target, target.scrollTop);
    };
    scroller.addEventListener("scroll", record, { capture: true, passive: true });
    return () => scroller.removeEventListener("scroll", record, { capture: true });
  }, []);
  useLayoutEffect(() => {
    const scroller = marker.current?.closest(".page");
    if (!scroller || current.current === key) return;
    current.current = key;
    const saved = top ? null : positions.current.get(key);
    const restore = () => {
      if (current.current !== key) return;
      if (!saved?.has(scroller)) scroller.scrollTop = 0;
      for (const [element, position] of saved ?? []) if (element.isConnected) element.scrollTop = position;
    };
    restore();
    // A virtualized list measures its rows only once it shows again; settle after it has.
    let frame = requestAnimationFrame(() => { restore(); frame = requestAnimationFrame(restore); });
    return () => cancelAnimationFrame(frame);
  }, [key, top]);
  return marker;
}
