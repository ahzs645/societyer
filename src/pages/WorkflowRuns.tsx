import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer } from "../components/ui";
import {
  History,
  CheckCircle2,
  Circle,
  XCircle,
  Loader2,
  MinusCircle,
} from "lucide-react";
import { formatDateTime } from "../lib/format";
import {
  RecordTable,
  RecordTableScope,
  RecordTableToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Workflow-run history. Read-only, like the audit log — the records
 * are written by the workflow engine, not edited by hand. The page
 * projects `workflowName` / `recipeLabel` into each record before
 * handing them to the table so the metadata-driven columns just work.
 */
export function WorkflowRunsPage() {
  const society = useSociety();
  const runs = useQuery(
    api.workflows.listRuns,
    society ? { societyId: society._id, limit: 100 } : "skip",
  );
  const workflows = useQuery(
    api.workflows.list,
    society ? { societyId: society._id } : "skip",
  );
  const catalog = useQuery(api.workflows.listCatalog, {});
  const [searchParams] = useSearchParams();
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "workflowRun",
    viewId: currentViewId,
  });

  const workflowsById = useMemo(
    () => new Map<string, any>((workflows ?? []).map((w: any) => [w._id, w])),
    [workflows],
  );

  const workflowFilter = searchParams.get("workflowId");
  const providerFilter = searchParams.get("provider");
  const triggeredByFilter = searchParams.get("triggeredBy");

  // Project the derived fields (`workflowName`, `recipeLabel`) into
  // each record before they're handed to the table. Doing this here —
  // rather than in a Convex query — keeps workflow-catalog logic on
  // the client where the labels live.
  const visibleRuns = useMemo(() => {
    const byKey = new Map<string, any>((catalog ?? []).map((c) => [c.key, c]));
    return (runs ?? [])
      .filter((run: any) =>
        (!workflowFilter || run.workflowId === workflowFilter) &&
        (!providerFilter || run.provider === providerFilter) &&
        (!triggeredByFilter || run.triggeredBy === triggeredByFilter)
      )
      .map((run: any) => ({
        ...run,
        workflowName: workflowsById.get(run.workflowId)?.name ?? "—",
        recipeLabel: byKey.get(run.recipe)?.label ?? run.recipe,
      }));
  }, [runs, workflowsById, catalog, workflowFilter, providerFilter, triggeredByFilter]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Workflow runs"
        icon={<History size={16} />}
        iconColor="gray"
        subtitle="Step-by-step execution history for every configured workflow. Click a row for timeline detail."
      />

      {showMetadataWarning ? (
        <div className="record-table__empty">
          <div className="record-table__empty-title">Metadata not seeded</div>
          <div className="record-table__empty-desc">
            Run <code>npx convex run seedRecordTableMetadata:run</code> to create the
            workflow-run object metadata + default view.
          </div>
        </div>
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="workflow-runs"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={visibleRuns}
          onRecordClick={(_, record) => setSelectedRun(record)}
        >
          <RecordTableToolbar
            icon={<History size={14} />}
            label="Recent runs"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || runs === undefined}
            emptyState={
              <div className="record-table__empty">
                <div className="record-table__empty-title">No runs yet</div>
                <div className="record-table__empty-desc">
                  Trigger a workflow from the Workflows page.
                </div>
              </div>
            }
            renderCell={({ record, field, value }) => {
              if (field.name === "workflowName") {
                const wf = workflowsById.get(record.workflowId);
                return wf ? (
                  <Link
                    className="link"
                    to={`/app/workflows/${wf._id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {wf.name}
                  </Link>
                ) : (
                  <span className="muted">—</span>
                );
              }
              if (field.name === "recipeLabel") {
                return <span className="cell-tag">{String(value ?? "")}</span>;
              }
              if (field.name === "triggeredBy") {
                return (
                  <span className="mono" style={{ fontSize: "var(--fs-sm)" }}>
                    {String(value ?? "")}
                  </span>
                );
              }
              return undefined;
            }}
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

      <Drawer
        open={!!selectedRun}
        onClose={() => setSelectedRun(null)}
        title={
          selectedRun
            ? `${selectedRun.workflowName} · ${selectedRun.status}`
            : "Run detail"
        }
      >
        {selectedRun && (
          <div>
            <div className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 12 }}>
              Recipe: <strong>{selectedRun.recipeLabel}</strong> · Triggered{" "}
              <span className="mono">{selectedRun.triggeredBy}</span>
              {selectedRun.startedAtISO && (
                <>
                  {" "}
                  · Started{" "}
                  <span className="mono">{formatDateTime(selectedRun.startedAtISO)}</span>
                </>
              )}
              {selectedRun.completedAtISO && (
                <>
                  {" "}
                  · Completed{" "}
                  <span className="mono">
                    {formatDateTime(selectedRun.completedAtISO)}
                  </span>
                </>
              )}
            </div>
            <StepTimeline steps={selectedRun.steps ?? []} />
            {selectedRun.output && (
              <pre
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: "var(--surface-subtle)",
                  borderRadius: 6,
                  fontSize: "var(--fs-sm)",
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-secondary)",
                }}
              >
                {JSON.stringify(selectedRun.output, null, 2)}
              </pre>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function StepTimeline({
  steps,
}: {
  steps: Array<{ label: string; status: string; atISO?: string; note?: string }>;
}) {
  return (
    <div className="bot-steps" style={{ padding: 0 }}>
      {steps.map((s, i) => {
        const Icon =
          s.status === "ok"
            ? CheckCircle2
            : s.status === "fail"
              ? XCircle
              : s.status === "running"
                ? Loader2
                : s.status === "skip"
                  ? MinusCircle
                  : Circle;
        const color =
          s.status === "ok"
            ? "var(--success)"
            : s.status === "fail"
              ? "var(--danger)"
              : s.status === "running"
                ? "var(--accent)"
                : "var(--text-tertiary)";
        const isSkip = s.status === "skip";
        return (
          <div
            key={i}
            className={`bot-step bot-step--${s.status}`}
            style={isSkip ? { opacity: 0.55 } : undefined}
          >
            <Icon
              size={14}
              style={{
                color,
                animation: s.status === "running" ? "spin 1.2s linear infinite" : undefined,
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={isSkip ? { textDecoration: "line-through" } : undefined}>
                {s.label}
              </div>
              {s.note && (
                <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                  {s.note}
                </div>
              )}
            </div>
            {s.atISO && (
              <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                {new Date(s.atISO).toLocaleTimeString()}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
