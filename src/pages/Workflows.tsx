import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field, Badge } from "../components/ui";
import { ExternalLink, Plus, Workflow as WorkflowIcon, Play, Pause, Trash2 } from "lucide-react";
import { formatDateTime } from "../lib/format";

type TriggerKind = "cron" | "manual" | "date_offset";

export function WorkflowsPage() {
  const society = useSociety();
  const catalog = useQuery(api.workflows.listCatalog, {});
  const rows = useQuery(api.workflows.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.workflows.create);
  const setStatus = useMutation(api.workflows.setStatus);
  const remove = useMutation(api.workflows.remove);
  const run = useAction(api.workflows.run);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    recipe: string;
    name: string;
    triggerKind: TriggerKind;
    cron: string;
    daysBefore: string;
    anchor: string;
    provider?: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = (recipeKey?: string) => {
    const first = recipeKey ?? catalog?.[0]?.key ?? "agm_prep";
    const selected = catalog?.find((c: any) => c.key === first);
    const isUnbc = first === "unbc_affiliate_id_request";
    setForm({
      recipe: first,
      name: selected?.label ?? "New workflow",
      triggerKind: isUnbc ? "manual" : "cron",
      cron: isUnbc ? "" : "0 8 * * 1",
      daysBefore: "30",
      anchor: "insurancePolicies.renewalDate",
      provider: selected?.provider ?? "internal",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form) return;
    const trigger: any = { kind: form.triggerKind };
    if (form.triggerKind === "cron") trigger.cron = form.cron;
    if (form.triggerKind === "date_offset") {
      trigger.offset = {
        anchor: form.anchor,
        daysBefore: Number(form.daysBefore) || 30,
      };
    }
    await create({
      societyId: society._id,
      recipe: form.recipe,
      name: form.name || "Untitled workflow",
      trigger,
      provider: form.provider,
      status: "active",
      actingUserId,
    });
    setOpen(false);
    toast.success("Workflow created");
  };

  return (
    <div className="page">
      <PageHeader
        title="Workflows"
        icon={<WorkflowIcon size={16} />}
        iconColor="orange"
        subtitle="Native workflow control with Societyer context and n8n execution for external automations."
        actions={
          <>
            <button className="btn-action" onClick={() => openNew("unbc_affiliate_id_request")}>
              <WorkflowIcon size={12} /> UNBC example
            </button>
            <button className="btn-action btn-action--primary" onClick={() => openNew()}>
              <Plus size={12} /> New workflow
            </button>
          </>
        }
      />

      <div className="card">
        <div className="card__head">
          <h3 className="card__title">Configured workflows</h3>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          {(rows ?? []).length === 0 ? (
            <div className="empty-state">
              No workflows yet. Pick a recipe from the catalog to get started.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Recipe</th>
                  <th>Trigger</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Last run</th>
                  <th>Next run</th>
                  <th style={{ width: 1 }}></th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r: any) => {
                  const recipe = catalog?.find((c) => c.key === r.recipe);
                  return (
                    <tr key={r._id}>
                      <td>
                        <Link className="link" to={`/app/workflows/${r._id}`}>
                          {r.name}
                        </Link>
                      </td>
                      <td>{recipe?.label ?? r.recipe}</td>
                      <td className="mono" style={{ fontSize: "var(--fs-sm)" }}>
                        {r.trigger.kind === "cron"
                          ? r.trigger.cron
                          : r.trigger.kind === "date_offset"
                          ? `${r.trigger.offset?.daysBefore}d before ${r.trigger.offset?.anchor}`
                          : "manual"}
                      </td>
                      <td>
                        <Badge tone={r.provider === "n8n" ? "info" : "neutral"}>
                          {r.provider ?? "internal"}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={r.status === "active" ? "success" : r.status === "paused" ? "warn" : "neutral"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
                        {r.lastRunAtISO ? formatDateTime(r.lastRunAtISO) : "—"}
                      </td>
                      <td className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
                        {r.nextRunAtISO ? formatDateTime(r.nextRunAtISO) : "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link className="btn btn--ghost btn--sm" to={`/app/workflows/${r._id}`}>
                          <ExternalLink size={12} /> Canvas
                        </Link>
                        <button
                          className="btn btn--ghost btn--sm"
                          disabled={busyId === r._id}
                          onClick={async () => {
                            setBusyId(r._id);
                            try {
                              const result = await run({
                                societyId: society._id,
                                workflowId: r._id,
                                triggeredBy: "manual",
                                actingUserId,
                              });
                              toast.success(result?.status === "running" ? "Workflow queued in n8n" : "Workflow run complete");
                            } catch (err: any) {
                              toast.error(err?.message ?? "Run failed");
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          <Play size={12} /> Run now
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() =>
                            setStatus({
                              id: r._id,
                              status: r.status === "active" ? "paused" : "active",
                              actingUserId,
                            })
                          }
                        >
                          <Pause size={12} /> {r.status === "active" ? "Pause" : "Resume"}
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={async () => {
                            await remove({ id: r._id, actingUserId });
                            toast.success("Workflow removed");
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New workflow"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Create</button>
          </>
        }
      >
        {form && (
          <>
            <Field label="Recipe">
              <select
                value={form.recipe}
                onChange={(e) => {
                  const next = catalog?.find((c: any) => c.key === e.target.value);
                  const isUnbc = e.target.value === "unbc_affiliate_id_request";
                  setForm({
                    ...form,
                    recipe: e.target.value,
                    name: next?.label ?? form.name,
                    provider: next?.provider ?? "internal",
                    triggerKind: isUnbc ? "manual" : form.triggerKind,
                    cron: isUnbc ? "" : form.cron,
                  });
                }}
              >
                {(catalog ?? []).map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </Field>
            {catalog?.find((c) => c.key === form.recipe)?.description && (
              <div className="muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
                {catalog.find((c) => c.key === form.recipe)?.description}
              </div>
            )}
            <Field label="Name">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Provider">
              <input value={form.provider ?? "internal"} readOnly />
            </Field>
            <Field label="Trigger">
              <select
                value={form.triggerKind}
                onChange={(e) => setForm({ ...form, triggerKind: e.target.value as TriggerKind })}
              >
                <option value="cron">Scheduled (cron)</option>
                <option value="date_offset">Days before a date</option>
                <option value="manual">Manual only</option>
              </select>
            </Field>
            {form.triggerKind === "cron" && (
              <Field label="Cron expression">
                <input
                  className="mono"
                  value={form.cron}
                  onChange={(e) => setForm({ ...form, cron: e.target.value })}
                  placeholder="0 8 * * 1"
                />
              </Field>
            )}
            {form.triggerKind === "date_offset" && (
              <>
                <Field label="Anchor">
                  <select
                    value={form.anchor}
                    onChange={(e) => setForm({ ...form, anchor: e.target.value })}
                  >
                    <option value="insurancePolicies.renewalDate">Insurance renewal date</option>
                    <option value="meetings.scheduledAt">Meeting scheduled date</option>
                    <option value="filings.dueDate">Filing due date</option>
                  </select>
                </Field>
                <Field label="Days before">
                  <input
                    type="number"
                    value={form.daysBefore}
                    onChange={(e) => setForm({ ...form, daysBefore: e.target.value })}
                  />
                </Field>
              </>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
