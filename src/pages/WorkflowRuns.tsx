import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import {
  History,
  CheckCircle2,
  Circle,
  XCircle,
  Loader2,
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const workflowsById = new Map<string, any>((workflows ?? []).map((w: any) => [w._id, w]));

  return (
    <div className="page">
      <PageHeader
        title="Workflow runs"
        icon={<History size={16} />}
        iconColor="gray"
        subtitle="Step-by-step execution history for every configured workflow. Click a row for timeline detail."
      />

      <div className="card">
        <div className="card__head">
          <h3 className="card__title">Recent runs</h3>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {(runs ?? []).length === 0 ? (
            <div className="muted" style={{ padding: 16, textAlign: "center" }}>
              No runs yet. Trigger a workflow from the Workflows page.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Workflow</th>
                  <th>Recipe</th>
                  <th>Status</th>
                  <th>Triggered</th>
                  <th>Started</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {(runs ?? []).map((r: any) => {
                  const wf = workflowsById.get(r.workflowId);
                  const recipe = catalog?.find((c) => c.key === r.recipe);
                  const expanded = expandedId === r._id;
                  return (
                    <>
                      <tr
                        key={r._id}
                        style={{ cursor: "pointer" }}
                        onClick={() => setExpandedId(expanded ? null : r._id)}
                      >
                        <td style={{ width: 20 }}>{expanded ? "▾" : "▸"}</td>
                        <td>{wf?.name ?? "—"}</td>
                        <td>{recipe?.label ?? r.recipe}</td>
                        <td>
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
                        </td>
                        <td className="mono" style={{ fontSize: "var(--fs-sm)" }}>
                          {r.triggeredBy}
                        </td>
                        <td className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
                          {formatDateTime(r.startedAtISO)}
                        </td>
                        <td className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
                          {r.completedAtISO ? formatDateTime(r.completedAtISO) : "—"}
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${r._id}-steps`}>
                          <td></td>
                          <td colSpan={6} style={{ background: "var(--surface-subtle)" }}>
                            <StepTimeline steps={r.steps} />
                            {r.output && (
                              <pre
                                style={{
                                  marginTop: 8,
                                  fontSize: "var(--fs-sm)",
                                  whiteSpace: "pre-wrap",
                                  fontFamily: "var(--font-mono)",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {JSON.stringify(r.output, null, 2)}
                              </pre>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function StepTimeline({ steps }: { steps: Array<{ label: string; status: string; atISO?: string; note?: string }> }) {
  return (
    <div className="bot-steps" style={{ padding: 12 }}>
      {steps.map((s, i) => {
        const Icon =
          s.status === "ok"
            ? CheckCircle2
            : s.status === "fail"
            ? XCircle
            : s.status === "running"
            ? Loader2
            : Circle;
        const color =
          s.status === "ok"
            ? "var(--success)"
            : s.status === "fail"
            ? "var(--danger)"
            : s.status === "running"
            ? "var(--accent)"
            : "var(--text-tertiary)";
        return (
          <div key={i} className={`bot-step bot-step--${s.status}`}>
            <Icon
              size={14}
              style={{
                color,
                animation: s.status === "running" ? "spin 1.2s linear infinite" : undefined,
              }}
            />
            <div style={{ flex: 1 }}>
              <div>{s.label}</div>
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
