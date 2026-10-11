import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { CalendarRange, FileWarning, ListChecks, PieChart, Settings2, Sparkles } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { Banner } from "../components/ui";
import { Select } from "../components/Select";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { InfoPopover } from "../components/InfoPopover";
import { formatDate } from "../lib/format";
import { ContinuityHeatmap, StatusLegend } from "../features/gaps/ContinuityHeatmap";
import { PeriodDrawer, type PeriodSelection } from "../features/gaps/PeriodDrawer";
import { RecordGapsPanel } from "../features/gaps/RecordGapsPanel";
import { SystemGapsPanel } from "../features/gaps/SystemGapsPanel";
import { NativeCoveragePanel } from "../features/gaps/NativeCoveragePanel";
import { ExpectationsPanel } from "../features/gaps/ExpectationsPanel";
import type { ContinuityPeriod, ContinuityRow } from "../../shared/continuity";
import "../features/gaps/coverage.css";

const TABS = [
  { id: "continuity", label: "Record continuity", icon: CalendarRange },
  { id: "record", label: "Record gaps", icon: ListChecks },
  { id: "system", label: "System gaps", icon: FileWarning },
  { id: "coverage", label: "Native coverage", icon: PieChart },
  { id: "expectations", label: "Expectations", icon: Settings2 },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Coverage & gaps (findings A14, A15, B11; audit section 4). Generic for any
 * organization: record continuity (what should exist vs what does), record
 * gaps by severity, the system-gap backlog, native coverage and the
 * expectations that drive it. Replaces the PGAIR-specific source coverage page.
 */
export function CoverageGapsPage() {
  const society = useSociety();
  const { can, loaded } = usePermissions();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((item) => item.id === params.get("tab")) ? params.get("tab") : "continuity") as TabId;
  const setTab = (next: TabId) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    if (next !== "system") { nextParams.delete("affectedTable"); nextParams.delete("affectedId"); nextParams.delete("gap"); }
    setParams(nextParams, { replace: true });
  };
  const [fromYear, setFromYear] = useState<string>("");
  const [mode, setMode] = useState<"years" | "months">("years");
  const [monthYear, setMonthYear] = useState<number>(new Date().getFullYear());
  const [bodyFilter, setBodyFilter] = useState<string>("all");
  const [selection, setSelection] = useState<PeriodSelection | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  // Phones scroll the tab row sideways; keep the active tab in view (e.g. a ?tab=system link).
  useEffect(() => {
    const list = tabsRef.current;
    const active = list?.querySelector<HTMLElement>(".is-active");
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = Math.max(0, active.offsetLeft - list.offsetLeft - 16);
  }, [tab, society]);
  const canRead = can("deadlines:read");
  const data = useQuery(
    api.continuity.gaps,
    society && canRead && tab !== "system" && tab !== "coverage" ? { societyId: society._id, ...(fromYear ? { from: `${fromYear}-01-01` } : {}) } : "skip",
  ) as any;

  const rows: ContinuityRow[] = useMemo(() => (data?.rows ?? []).filter((row: ContinuityRow) => bodyFilter === "all" || row.bodyKey === bodyFilter), [data, bodyFilter]);
  const bodies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of (data?.rows ?? []) as ContinuityRow[]) seen.set(row.bodyKey, row.bodyLabel);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [data]);

  if (society === undefined) return <PageLoading />;
  if (!society) return <SeedPrompt />;
  if (loaded && !canRead && !can("documents:read")) {
    return <div className="page"><PageHeader title="Coverage & gaps" /><Banner tone="info">Coverage and gaps need compliance (deadlines) or document read access.</Banner></div>;
  }

  const open = (row: ContinuityRow, periods: ContinuityPeriod[]) => setSelection({
    societyId: society._id,
    expectation: { ...row.expectation, bodyLabel: row.bodyLabel },
    periods,
  });
  // Keep the drawer in sync with live data after a mark changes a period.
  const liveSelection = selection && data
    ? (() => {
        const row = (data.rows as ContinuityRow[]).find((candidate) => candidate.expectation.key === selection.expectation.key);
        if (!row) return selection;
        const keys = new Set(selection.periods.map((period) => period.periodKey));
        return { ...selection, periods: row.periods.filter((period) => keys.has(period.periodKey)) };
      })()
    : selection;

  const yearOptions = data ? Array.from({ length: data.range.toYear - Math.min(data.range.fromYear, 2000) + 1 }, (_, i) => data.range.toYear - i) : [];
  const counts = data?.counts as Record<string, number> | undefined;

  return (
    <div className="page coverage-root">
      <PageHeader
        title="Coverage & gaps"
        subtitle="Which records should exist and which are missing."
        info={<p>What records should exist, which are missing, and which source details the app cannot hold yet.</p>}
        actions={<Link className="btn-action" to="/app/intake"><Sparkles size={12} /> AI intake runs</Link>}
      />
      <div ref={tabsRef} className="segmented coverage-tabs" role="tablist" aria-label="Coverage and gaps views">
        {TABS.map((item) => {
          const Icon = item.icon;
          const disabled = (item.id === "system" || item.id === "coverage") ? !can("documents:read") : !canRead;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`segmented__btn${tab === item.id ? " is-active" : ""}`}
              onClick={() => setTab(item.id)}
              disabled={disabled}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Icon size={12} /> {item.label}
            </button>
          );
        })}
      </div>

      {(tab === "continuity" || tab === "record" || tab === "expectations") && !data && canRead && <PageLoading />}

      {tab === "continuity" && data && (
        <>
          {counts && (
            <div className="stat-grid">
              <div className="stat"><div className="stat__label">Record missing</div><div className="stat__value">{counts.record_missing}</div></div>
              <div className="stat"><div className="stat__label">Only in source files</div><div className="stat__value">{counts.source_only}</div></div>
              <div className="stat"><div className="stat__label">Draft or unapproved</div><div className="stat__value">{counts.draft_only}</div></div>
              <div className="stat"><div className="stat__label">On file</div><div className="stat__value">{counts.satisfied}</div></div>
            </div>
          )}
          <div className="coverage-toolbar">
            <label className="col" style={{ gap: 4, fontSize: 12 }}>
              From
              <Select
                aria-label="From year"
                value={fromYear || String(data.range.fromYear)}
                onChange={(value) => setFromYear(value)}
                options={yearOptions.map((year: number) => ({ value: String(year), label: String(year) }))}
              />
            </label>
            <label className="col" style={{ gap: 4, fontSize: 12 }}>
              Body
              <Select aria-label="Body" value={bodyFilter} onChange={setBodyFilter} options={[{ value: "all", label: "All bodies" }, ...bodies]} />
            </label>
            <div className="segmented" role="group" aria-label="Granularity">
              <button type="button" className={`segmented__btn${mode === "years" ? " is-active" : ""}`} aria-pressed={mode === "years"} onClick={() => setMode("years")}>By year</button>
              <button type="button" className={`segmented__btn${mode === "months" ? " is-active" : ""}`} aria-pressed={mode === "months"} onClick={() => setMode("months")}>By month</button>
            </div>
            {mode === "months" && (
              <label className="col" style={{ gap: 4, fontSize: 12 }}>
                Year
                <Select aria-label="Month view year" value={String(monthYear)} onChange={(value) => setMonthYear(Number(value))} options={Array.from({ length: data.range.toYear - data.range.fromYear + 1 }, (_, i) => data.range.toYear - i).map((year) => ({ value: String(year), label: String(year) }))} />
              </label>
            )}
          </div>
          <div className="coverage-key">
            <StatusLegend />
            <span className="coverage-key__label">Key</span>
            <InfoPopover label="About record continuity">
              <p>Click a cell for evidence and actions. Evidence missing is shown separately from "not held": a period is only "never held" when someone marks it.</p>
              {data.rulePack && (
                <p>Statutory rows come from the {data.rulePack.title} rule pack (draft; checked against the Act current to {data.rulePack.sources[0]?.currentTo ? formatDate(data.rulePack.sources[0].currentTo) : "the retrieval date"}; not legal advice).</p>
              )}
              <StatusLegend />
            </InfoPopover>
          </div>
          <ContinuityHeatmap rows={rows} fromYear={data.range.fromYear} toYear={data.range.toYear} mode={mode} year={monthYear} onSelect={open} />
          {!data.readable.meetings && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Meeting records are not visible to your role.</p>}
        </>
      )}

      {tab === "record" && data && <RecordGapsPanel societyId={society._id} recordGaps={data.recordGaps} crossReferences={data.crossReferences} agreementGaps={(data as any).agreementGaps} rows={data.rows} onOpen={open} />}
      {tab === "system" && <SystemGapsPanel societyId={society._id} affectedTable={params.get("affectedTable") ?? undefined} affectedId={params.get("affectedId") ?? undefined} focusGapId={params.get("gap") ?? undefined} />}
      {tab === "coverage" && <NativeCoveragePanel societyId={society._id} />}
      {tab === "expectations" && data && <ExpectationsPanel societyId={society._id} suggestions={data.suggestions} />}

      <PeriodDrawer selection={liveSelection} onClose={() => setSelection(null)} />
    </div>
  );
}
