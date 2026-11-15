/**
 * The reader inside a page, in layers (routes.ts): the list or the analytics,
 * and a buyer or a commodity over them. A covered layer stays mounted but hidden, so its
 * loaded rows and table state (filters, sort, page) survive, and each place's
 * scroll position in the `.page` scroller is saved and put back, so Back
 * lands on the same rows. The module header shows over the list and the
 * analytics only; a buyer or a commodity brings its own.
 *
 * A notice opens in the app's record side panel over whatever shows
 * (notice/NoticePanel.tsx), as a meeting or a task does from its list: the
 * list stays where it is, with the open notice's row marked and kept in sight
 * as the panel steps through it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { Tabs } from "../../../components/primitives";
import { useRecordPanelStack } from "../../../platform/record-engine/record-table/components/RecordTableSidePanelStack";
import { CatalogBrowser } from "./CatalogBrowser";
import { BuyerPage } from "./BuyerPage";
import { CommodityPage } from "./commodity/CommodityPage";
import { NoticePanel } from "./notice/NoticePanel";
import { ProcurementAnalytics } from "./analytics/ProcurementAnalytics";
import type { NoticeKind } from "./NoticeTable";
import { NoticePanelContext, NOTICE_PARAM, SECTION_PARAM, canonicalReaderParams, placeKey, readerPlaces, useReaderNavigation, useSettleClosedNotice, type ReaderPlace } from "./routes";
import { ReaderSourceContext, type ReaderSource } from "./source";
import { ReaderTriageContext, type ReaderTriage } from "./triage";
import { ListOrderContext, createListOrderStore } from "./listOrder";
import { NoticePanelOpenContext } from "./noticePanelOpen";

/** Reference data (taxonomy terms and the like) is published too, but isn't something a reviewer browses. */
const KINDS: { id: NoticeKind; label: string }[] = [
  { id: "opportunity", label: "Opportunities" },
  { id: "award", label: "Awards" },
];
const ANALYTICS = "analytics";

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
  const { notice, party, commodity, analytics } = readerPlaces(params);
  const kinds = KINDS.filter((kind) => (source.catalog.counts[kind.id] ?? 0) > 0);
  const kind: NoticeKind = kinds.find((item) => item.id === params.get("kind"))?.id ?? kinds[0]?.id ?? "opportunity";
  const place: ReaderPlace = party ? { layer: "party", ...party } : commodity ? { layer: "commodity", code: commodity } : analytics ? { layer: "analytics" } : { layer: "list", kind };
  const over = Boolean(party || commodity);
  const marker = useScrollMemory(placeKey(place));
  useSettleClosedNotice();

  // Minimised and full screen, kept here rather than in the panel so a buyer
  // opened from a full-screen notice comes back to it. A notice closed to the
  // list or the analytics starts the next one as a panel again.
  const panel = useRecordPanelStack(notice);
  const { reset, setMinimised } = panel;
  useEffect(() => {
    if (!notice && !over) reset();
  }, [notice, over, reset]);
  const panelScope = useMemo(() => ({ inside: false, restore: () => setMinimised(false) }), [setMinimised]);
  const closeNotice = nav.closeNotice;

  const chooseTab = (id: string) => {
    // With a notice open, another tab closes it too: it belongs to the list it was opened from.
    const closing: Record<string, string | null> = notice ? { [NOTICE_PARAM]: null, tab: null } : {};
    if (id === ANALYTICS) {
      if (notice) update({ ...closing, [SECTION_PARAM]: ANALYTICS });
      else if (!analytics) nav.openAnalytics();
      return;
    }
    if (notice && !analytics && id === kind) { closeNotice(); return; }
    // Back from the analytics to the list it opened over, or a list of another kind in place.
    if (!notice && analytics && nav.pushed && id === kind) { nav.back(); return; }
    update({ ...closing, section: null, kind: id === "opportunity" ? null : id, status: null, q: null });
  };

  return (
    <NoticePanelContext.Provider value={panelScope}>
      <div className="procurement-reader__layers">
        <span ref={marker} hidden />
        <Layer covered={over} className="procurement-reader__list">
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
            <NoticePanelOpenContext.Provider value={Boolean(notice) && !over && !analytics}>
              <CatalogBrowser key={kind} kind={kind} />
            </NoticePanelOpenContext.Provider>
          </Layer>
          {analytics && <ProcurementAnalytics />}
        </Layer>
        {party && (
          <Layer covered={false}>
            <BuyerPage key={`${party.field}:${party.name}`} field={party.field} name={party.name} />
          </Layer>
        )}
        {commodity && (
          <Layer covered={false}>
            <CommodityPage key={commodity} code={commodity} />
          </Layer>
        )}
        {/* One panel across previous and next, so closing returns focus to where it was opened from. */}
        {notice && <NoticePanel recordKey={notice} panel={panel} onClose={() => { reset(); closeNotice(); }} />}
      </div>
    </NoticePanelContext.Provider>
  );
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
 * shows again: the top for a place not seen before. The notice panel is
 * outside the page, so opening and closing it leaves the page where it is.
 */
function useScrollMemory(key: string) {
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
    const saved = positions.current.get(key);
    const restore = () => {
      if (current.current !== key) return;
      if (!saved?.has(scroller)) scroller.scrollTop = 0;
      for (const [element, position] of saved ?? []) if (element.isConnected) element.scrollTop = position;
    };
    restore();
    // A virtualized list measures its rows only once it shows again; settle after it has.
    let frame = requestAnimationFrame(() => { restore(); frame = requestAnimationFrame(restore); });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return marker;
}
