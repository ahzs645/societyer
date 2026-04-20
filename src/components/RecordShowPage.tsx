import { ReactNode, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader as TitleHeader } from "../pages/_helpers";
import { Tabs } from "./primitives";

export type RecordShowTab = {
  id: string;
  label: string;
  count?: number | null;
  icon?: ReactNode;
  content: ReactNode;
};

export type RecordSummaryItem = {
  label: ReactNode;
  value: ReactNode;
};

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
}) {
  const [params, setParams] = useSearchParams();
  const urlTab = params.get("tab");
  const active =
    tabs.find((t) => t.id === urlTab)?.id ??
    defaultTab ??
    tabs[0]?.id ??
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

  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="record-show">
      <div className="record-show__main">
        <TitleHeader
          title={title}
          subtitle={subtitle}
          icon={icon}
          iconColor={iconColor}
          actions={actions}
        />
        {chips && <div className="record-show__chips">{chips}</div>}
        {summary && summary.length > 0 && (
          <dl className="record-show__summary">
            {summary.map((item, i) => (
              <div key={i} className="record-show__summary-item">
                <dt className="record-show__summary-label">{item.label}</dt>
                <dd className="record-show__summary-value">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <Tabs<string>
          value={active}
          onChange={setTab}
          items={tabs.map(({ id, label, count, icon }) => ({ id, label, count, icon }))}
        />
        <div className="record-show__content">{activeTab?.content}</div>
      </div>
      {inspector && <aside className="record-show__inspector">{inspector}</aside>}
    </div>
  );
}
