/**
 * The reader inside a page, in layers (routes.ts): the list or the analytics,
 * a buyer over them, a notice over that. A covered layer stays mounted but
 * hidden, so its loaded rows and table state (filters, sort, page) survive,
 * and each place's scroll position in the `.page` scroller is saved and put
 * back, so Back lands on the same rows. Opening a notice starts at its top.
 * The module header shows over the list and the analytics only; a buyer and
 * a notice bring their own.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { Tabs } from "../../../components/primitives";
import { CatalogBrowser } from "./CatalogBrowser";
import { BuyerPage } from "./BuyerPage";
import { NoticePage } from "./NoticePage";
import { ProcurementAnalytics } from "./analytics/ProcurementAnalytics";
import type { NoticeKind } from "./NoticeTable";
import { placeKey, readerPlaces, useReaderNavigation, type ReaderPlace } from "./routes";
import { ReaderSourceContext, type ReaderSource } from "./source";

/** Reference data (taxonomy terms and the like) is published too, but isn't something a reviewer browses. */
const KINDS: { id: NoticeKind; label: string }[] = [
  { id: "opportunity", label: "Opportunities" },
  { id: "award", label: "Awards" },
];
const ANALYTICS = "analytics";

export function ProcurementReader({ source, header }: { source: ReaderSource; header: ReactNode }) {
  return (
    <ReaderSourceContext.Provider value={source}>
      <ReaderLayers source={source} header={header} />
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
  const covered = place.layer === "notice" || place.layer === "party";
  const marker = useScrollMemory(placeKey(place), place.layer === "notice");

  const chooseTab = (id: string) => {
    if (id === ANALYTICS) { if (!analytics) nav.openAnalytics(); return; }
    // Back from the analytics to the list it opened over, or a list of another kind in place.
    if (analytics && nav.pushed && id === kind) { nav.back(); return; }
    update({ section: null, kind: id === "opportunity" ? null : id, status: null, q: null });
  };

  return (
    <>
      <span ref={marker} hidden />
      <Layer covered={covered}>
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
        <Layer covered={analytics}><CatalogBrowser key={kind} kind={kind} /></Layer>
        {analytics && <ProcurementAnalytics />}
      </Layer>
      {party && (
        <Layer covered={Boolean(notice)}>
          <BuyerPage key={`${party.field}:${party.name}`} field={party.field} name={party.name} />
        </Layer>
      )}
      {notice && <NoticePage key={notice} recordKey={notice} listHref={nav.parentHref()} onBack={nav.back} />}
    </>
  );
}

/**
 * A place another one covers: still mounted and laid out (collapsed and out of
 * sight rather than `display: none`, which would throw away its scrollers'
 * positions), and out of the accessibility tree and the tab order.
 */
function Layer({ covered, children }: { covered: boolean; children: ReactNode }) {
  return <div className={covered ? "procurement-reader__layer is-covered" : "procurement-reader__layer"} aria-hidden={covered || undefined}>{children}</div>;
}

/**
 * Saves the scroll positions of the place showing (the `.page` and any
 * scroller inside it, such as a table's own), and puts a place's back when it
 * shows again: the top for a place not seen before, and always for a notice.
 */
function useScrollMemory(key: string, top: boolean) {
  const marker = useRef<HTMLSpanElement>(null);
  const positions = useRef(new Map<string, Map<Element, number>>());
  const current = useRef(key);
  useLayoutEffect(() => {
    const scroller = marker.current?.closest(".page");
    if (!scroller) return;
    // Scroll events don't bubble; listening in the capture phase hears every scroller under the page.
    const record = (event: Event) => {
      const target = event.target === document ? scroller : event.target;
      if (!(target instanceof Element) || !scroller.contains(target) || !target.isConnected || target.closest(".is-covered")) return;
      let saved = positions.current.get(current.current);
      if (!saved) positions.current.set(current.current, saved = new Map());
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
