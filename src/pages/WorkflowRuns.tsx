import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import {
  History,
  CheckCircle2,
  Circle,
  XCircle,
  Loader2,
  MinusCircle,
  Activity,
  Workflow as WorkflowIcon,
  Tag,
  Zap,
} from "lucide-react";
import { formatDateTime } from "../lib/format";

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

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const workflowsById = new Map<string, any>((workflows ?? []).map((w: any) => [w._id, w]));
  const workflowFilter = searchParams.get("workflowId");
  const visibleRuns = (runs ?? []).filter(
    (run: any) => !workflowFilter || run.workflowId === workflowFilter,
  );

  const recipeLabel = (key: string) => catalog?.find((c) => c.key === key)?.label ?? key;
  const workflowName = (id: string) => workflowsById.get(id)?.name ?? "—";

  const uniq = (xs: string[]) => Array.from(new Set(xs)).filter(Boolean);
  const filterFields: FilterField<any>[] = useMemo(() => {
    const workflowOptions = uniq(
      visibleRuns.map((r: any) => workflowName(r.workflowId)),
    ).filter((name) => name !== "—");
    return [
      {
        id: "workflow",
        label: "Workflow",
        icon: <WorkflowIcon size={14} />,
        options: workflowOptions,
        match: (r, q) => workflowName(r.workflowId) === q,
      },
      {
        id: "status",
        label: "Status",
        icon: <Activity size={14} />,
        options: ["success", "failed", "running"],
        match: (r, q) => r.status === q,
      },
      {
        id: "triggeredBy",
        label: "Triggered",
        icon: <Zap size={14} />,
        options: uniq(visibleRuns.map((r: any) => String(r.triggeredBy ?? ""))),
        match: (r, q) => r.triggeredBy === q,
      },
      {
        id: "recipe",
        label: "Recipe",
        icon: <Tag size={14} />,
        options: uniq(visibleRuns.map((r: any) => recipeLabel(r.recipe))),
        match: (r, q) => recipeLabel(r.recipe) === q,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRuns, catalog, workflows]);

  return (
    <div className="page">
      <PageHeader
        title="Workflow runs"
        icon={<History size={16} />}
        iconColor="gray"
        subtitle="Step-by-step execution history for every configured workflow. Click a row for timeline detail."
      />

      <DataTable
        label="Recent runs"
        icon={<History size={14} />}
        data={visibleRuns as any[]}
        rowKey={(r) => String(r._id)}
        searchPlaceholder="Search workflow, recipe, status…"
        defaultSort={{ columnId: "startedAtISO", dir: "desc" }}
        viewsKey="workflow-runs"
        emptyMessage="No runs yet. Trigger a workflow from the Workflows page."
        onRowClick={(r) => setSelectedRun(r)}
        rowActionLabel={(r) => `Open run detail for ${workflowName(r.workflowId)}`}
        filterFields={filterFields}
        searchExtraFields={[
          (r) => workflowName(r.workflowId),
          (r) => recipeLabel(r.recipe),
        ]}
        pagination
        columns={[
          {
            id: "workflow",
            header: "Workflow",
            sortable: true,
            accessor: (r) => workflowName(r.workflowId),
            render: (r) => {
              const wf = workflowsById.get(r.workflowId);
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
            },
          },
          {
            id: "recipe",
            header: "Recipe",
            sortable: true,
            accessor: (r) => recipeLabel(r.recipe),
            render: (r) => <span className="cell-tag">{recipeLabel(r.recipe)}</span>,
          },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (r) => r.status,
            render: (r) => (
              <Badge
                tone={
                  r.status === "success"
                    ? "success"
                    : r.status === "failed"
                      ? "danger"
                      : "warn"
                }
              >
                {r.status}
              </Badge>
            ),
          },
          {
            id: "triggeredBy",
            header: "Triggered",
            sortable: true,
            accessor: (r) => r.triggeredBy,
            render: (r) => (
              <span className="mono" style={{ fontSize: "var(--fs-sm)" }}>
                {r.triggeredBy}
              </span>
            ),
          },
          {
            id: "startedAtISO",
            header: "Started",
            sortable: true,
            accessor: (r) => r.startedAtISO ?? "",
            render: (r) => (
              <span className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
                {r.startedAtISO ? formatDateTime(r.startedAtISO) : "—"}
              </span>
            ),
          },
          {
            id: "completedAtISO",
            header: "Completed",
            sortable: true,
            accessor: (r) => r.completedAtISO ?? "",
            render: (r) => (
              <span className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
                {r.completedAtISO ? formatDateTime(r.completedAtISO) : "—"}
              </span>
            ),
          },
        ]}
      />

      <Drawer
        open={!!selectedRun}
        onClose={() => setSelectedRun(null)}
        title={
          selectedRun
            ? `${workflowName(selectedRun.workflowId)} · ${selectedRun.status}`
            : "Run detail"
        }
      >
        {selectedRun && (
          <div>
            <div className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 12 }}>
              Recipe: <strong>{recipeLabel(selectedRun.recipe)}</strong> · Triggered{" "}
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
