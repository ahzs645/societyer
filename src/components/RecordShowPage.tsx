import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useLocation, useSearchParams } from "react-router-dom";
import { PageHeader as TitleHeader } from "../pages/_helpers";
import {
  clearRecordLayout,
  loadRecordLayout,
  makeRecordLayoutStorageKey,
  orderWidgets,
  RecordLayoutScope,
  RecordLayoutSection,
  RecordLayoutState,
  RecordLayoutWidget,
  saveRecordLayout,
  sectionState,
  updateSection,
  visibleWidgets,
} from "../lib/recordLayouts";
import { Tabs } from "./primitives";

export type RecordShowTab = {
  id: string;
  label: string;
  count?: number | null;
  icon?: ReactNode;
  content: ReactNode;
};

export type RecordSummaryItem = {
  id?: string;
  label: ReactNode;
  value: ReactNode;
};

export type RecordShowLayoutOptions =
  | false
  | (RecordLayoutScope & {
      enableControls?: boolean;
      inspectorId?: string;
      inspectorLabel?: string;
    });

/** Shared record "show page" primitive: title + subtitle + summary grid +
 * tabbed content + optional right-hand inspector slot. The active tab syncs
 * to the `tab` URL search param so deep-links work. */
export function RecordShowPage({
  title,
  subtitle,
  icon,
  iconColor,
  actions,
  chips,
  summary,
  tabs,
  defaultTab,
  inspector,
  layout,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  iconColor?: "blue" | "red" | "turquoise" | "gray" | "orange" | "purple" | "green" | "pink" | "yellow";
  actions?: ReactNode;
  /** Chip row shown below the title (status/tone indicators). */
  chips?: ReactNode;
  /** Dense key/value grid shown before the tabs. */
  summary?: RecordSummaryItem[];
  tabs: RecordShowTab[];
  defaultTab?: string;
  /** Right-side panel content (usually notes/activity). */
  inspector?: ReactNode;
  /** Local record detail layout scope. Omit to persist per current path. */
  layout?: RecordShowLayoutOptions;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [customizing, setCustomizing] = useState(false);
  const layoutEnabled = layout !== false;
  const layoutOptions = typeof layout === "object" && layout ? layout : {};
  const layoutControlsEnabled = layoutEnabled && layoutOptions.enableControls !== false;
  const storageKey = useMemo(
    () =>
      makeRecordLayoutStorageKey({
        storageKey: layoutOptions.storageKey,
        pageId: layoutOptions.pageId ?? location.pathname,
        objectId: layoutOptions.objectId,
      }),
    [layoutOptions.objectId, layoutOptions.pageId, layoutOptions.storageKey, location.pathname],
  );
  const [recordLayout, setRecordLayout] = useState<RecordLayoutState | null>(() =>
    layoutEnabled ? loadRecordLayout(storageKey) : null,
  );

  useEffect(() => {
    setRecordLayout(layoutEnabled ? loadRecordLayout(storageKey) : null);
  }, [layoutEnabled, storageKey]);

  const summaryWidgets = useMemo(
    () =>
      (summary ?? []).map((item, index) => ({
        ...item,
        id: item.id ?? `summary:${slugLabel(item.label, `item-${index + 1}`)}`,
      })),
    [summary],
  );
  const tabWidgets = useMemo(() => tabs.map((tab) => ({ ...tab, id: tab.id })), [tabs]);
  const inspectorWidget = inspector
    ? {
        id: layoutOptions.inspectorId ?? "inspector",
        label: layoutOptions.inspectorLabel ?? "Inspector",
        section: "inspector" as const,
      }
    : null;
  const visibleSummary = layoutEnabled ? visibleWidgets(summaryWidgets, recordLayout, "summary") : summaryWidgets;
  const visibleTabs = layoutEnabled ? visibleWidgets(tabWidgets, recordLayout, "tabs") : tabWidgets;
  const inspectorVisible =
    Boolean(inspector) &&
    (!layoutEnabled ||
      !inspectorWidget ||
      !sectionState(recordLayout, "inspector").hidden.includes(inspectorWidget.id));
  const urlTab = params.get("tab");
  const active =
    visibleTabs.find((t) => t.id === urlTab)?.id ??
    visibleTabs.find((t) => t.id === defaultTab)?.id ??
    visibleTabs[0]?.id ??
    "";
  const setTab = useCallback(
    (id: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", id);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const activeTab = visibleTabs.find((t) => t.id === active) ?? visibleTabs[0];
  const layoutWidgets = useMemo(
    () => [
      ...summaryWidgets.map((item) => ({
        id: item.id,
        label: displayLabel(item.label, item.id),
        section: "summary" as const,
      })),
      ...tabWidgets.map((tab) => ({ id: tab.id, label: tab.label, section: "tabs" as const })),
      ...(inspectorWidget ? [inspectorWidget] : []),
    ],
    [inspectorWidget, summaryWidgets, tabWidgets],
  );

  const commitLayout = useCallback(
    (next: RecordLayoutState | null) => {
      setRecordLayout(next);
      if (next) saveRecordLayout(storageKey, next);
      else clearRecordLayout(storageKey);
    },
    [storageKey],
  );

  const moveWidget = useCallback(
    (section: RecordLayoutSection, id: string, direction: -1 | 1) => {
      const sectionWidgets = layoutWidgets.filter((widget) => widget.section === section);
      const ordered = orderWidgets(sectionWidgets, recordLayout, section);
      const index = ordered.findIndex((widget) => widget.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return;
      const nextOrder = [...ordered.map((widget) => widget.id)];
      [nextOrder[index], nextOrder[target]] = [nextOrder[target], nextOrder[index]];
      commitLayout(updateSection(recordLayout, section, (state) => ({ ...state, order: nextOrder })));
    },
    [commitLayout, layoutWidgets, recordLayout],
  );

  const toggleWidget = useCallback(
    (section: RecordLayoutSection, id: string) => {
      commitLayout(
        updateSection(recordLayout, section, (state) => {
          const hidden = new Set(state.hidden);
          if (hidden.has(id)) hidden.delete(id);
          else hidden.add(id);
          return { ...state, hidden: Array.from(hidden) };
        }),
      );
    },
    [commitLayout, recordLayout],
  );

  const resetLayout = useCallback(() => {
    commitLayout(null);
    setCustomizing(false);
  }, [commitLayout]);

  const headerActions = layoutControlsEnabled ? (
    <div className="record-show__actions">
      {actions}
      <button
        type="button"
        className={`btn-action${customizing ? " btn-action--primary" : ""}`}
        onClick={() => setCustomizing((value) => !value)}
        aria-expanded={customizing}
      >
        <SlidersHorizontal size={12} /> Layout
      </button>
    </div>
  ) : (
    actions
  );

  return (
    <div className="record-show">
      <div className="record-show__main">
        <TitleHeader
          title={title}
          subtitle={subtitle}
          icon={icon}
          iconColor={iconColor}
          actions={headerActions}
        />
        {chips && <div className="record-show__chips">{chips}</div>}
        {customizing && layoutControlsEnabled && (
          <RecordLayoutCustomizer
            widgets={layoutWidgets}
            layout={recordLayout}
            onMove={moveWidget}
            onToggle={toggleWidget}
            onClose={() => setCustomizing(false)}
            onReset={resetLayout}
          />
        )}
        {visibleSummary.length > 0 && (
          <dl className="record-show__summary">
            {visibleSummary.map((item) => (
              <div key={item.id} className="record-show__summary-item">
                <dt className="record-show__summary-label">{item.label}</dt>
                <dd className="record-show__summary-value">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <Tabs<string>
          value={active}
          onChange={setTab}
          items={visibleTabs.map(({ id, label, count, icon }) => ({ id, label, count, icon }))}
        />
        <div className="record-show__content">{activeTab?.content}</div>
      </div>
      {inspectorVisible && <aside className="record-show__inspector">{inspector}</aside>}
    </div>
  );
}

function RecordLayoutCustomizer({
  widgets,
  layout,
  onMove,
  onToggle,
  onClose,
  onReset,
}: {
  widgets: RecordLayoutWidget[];
  layout: RecordLayoutState | null;
  onMove: (section: RecordLayoutSection, id: string, direction: -1 | 1) => void;
  onToggle: (section: RecordLayoutSection, id: string) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const sections: { id: RecordLayoutSection; label: string }[] = [
    { id: "summary", label: "Summary" },
    { id: "tabs", label: "Tabs" },
    { id: "inspector", label: "Inspector" },
  ];

  return (
    <section className="record-layout" aria-label="Record detail layout">
      <div className="record-layout__head">
        <div>
          <div className="record-layout__title">Record layout</div>
          <div className="record-layout__hint">Order or hide widgets for this record detail page.</div>
        </div>
        <div className="record-layout__head-actions">
          <button type="button" className="btn-action" onClick={onReset}>
            <RotateCcw size={12} /> Reset
          </button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close layout controls">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="record-layout__sections">
        {sections.map((section) => {
          const sectionWidgets = orderWidgets(
            widgets.filter((widget) => widget.section === section.id),
            layout,
            section.id,
          );
          const hidden = new Set(sectionState(layout, section.id).hidden);
          if (sectionWidgets.length === 0) return null;
          return (
            <div className="record-layout__section" key={section.id}>
              <div className="record-layout__section-title">{section.label}</div>
              <div className="record-layout__items">
                {sectionWidgets.map((widget, index) => {
                  const isHidden = hidden.has(widget.id);
                  return (
                    <div className={`record-layout__item${isHidden ? " is-hidden" : ""}`} key={widget.id}>
                      <span className="record-layout__item-label">{widget.label}</span>
                      <div className="record-layout__item-actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--icon"
                          onClick={() => onMove(section.id, widget.id, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${widget.label} up`}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--icon"
                          onClick={() => onMove(section.id, widget.id, 1)}
                          disabled={index === sectionWidgets.length - 1}
                          aria-label={`Move ${widget.label} down`}
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--icon"
                          onClick={() => onToggle(section.id, widget.id)}
                          aria-label={`${isHidden ? "Show" : "Hide"} ${widget.label}`}
                        >
                          {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function displayLabel(value: ReactNode, fallback: string) {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function slugLabel(value: ReactNode, fallback: string) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback
    : fallback;
}
