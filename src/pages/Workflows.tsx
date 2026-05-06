import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  ExternalLink,
  Plus,
  Workflow as WorkflowIcon,
  Play,
  Pause,
  Trash2,
} from "lucide-react";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

const triggerLabel = (trigger: any) =>
  trigger?.kind === "cron"
    ? trigger.cron
    : trigger?.kind === "date_offset"
      ? `${trigger.offset?.daysBefore}d before ${trigger.offset?.anchor}`
      : "manual";

type TriggerKind = "cron" | "manual" | "date_offset";

/**
 * Workflows management. Each row joins a `workflows` doc with the
 * recipe catalog (`recipeLabel`) and the derived `triggerLabel` from
 * the trigger config — both projected client-side since neither is a
 * real column. Inline edits for `name` and `status` route to
 * `workflows.update` (Director-gated, name/status only); richer
 * trigger / provider config still lives on the canvas page.
 */
export function WorkflowsPage() {
  const society = useSociety();
  const catalog = useQuery(api.workflows.listCatalog, {});
  const rows = useQuery(api.workflows.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.workflows.create);
  const setupGovernanceN8nRecipes = useMutation(api.workflows.setupGovernanceN8nRecipes);
  const update = useMutation(api.workflows.update);
  const setStatus = useMutation(api.workflows.setStatus);
  const remove = useMutation(api.workflows.remove);
  const run = useAction(api.workflows.run);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const navigate = useNavigate();

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
  const [setupBusy, setSetupBusy] = useState(false);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "workflow",
    viewId: currentViewId,
  });

  const recipeByKey = useMemo(
    () => new Map<string, any>((catalog ?? []).map((c: any) => [c.key, c])),
    [catalog],
  );

  const records = useMemo(
    () =>
      (rows ?? []).map((r: any) => ({
        ...r,
        recipeLabel: recipeByKey.get(r.recipe)?.label ?? r.recipe,
        triggerLabel: triggerLabel(r.trigger),
        provider: r.provider ?? "internal",
      })),
    [rows, recipeByKey],
  );

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = (recipeKey?: string) => {
    const first = recipeKey ?? catalog?.[0]?.key ?? "agm_prep";
    const selected = catalog?.find((c: any) => c.key === first);
    const defaultTriggerKind = selected?.config?.defaultTriggerKind;
    const triggerKind =
      defaultTriggerKind === "date_offset" || defaultTriggerKind === "cron" || defaultTriggerKind === "manual"
        ? defaultTriggerKind
        : selected?.provider === "n8n"
          ? "manual"
          : "cron";
    setForm({
      recipe: first,
      name: selected?.label ?? "New workflow",
      triggerKind,
      cron: triggerKind === "cron" ? "0 8 * * 1" : "",
      daysBefore: selected?.config?.daysBefore ? String(selected.config.daysBefore) : "30",
      anchor: selected?.config?.anchor ?? "insurancePolicies.renewalDate",
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

  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Workflows"
        icon={<WorkflowIcon size={16} />}
        iconColor="orange"
        subtitle="Native workflow control with Societyer context and n8n execution for external automations."
        actions={
          <>
            <Link className="btn-action" to="/app/workflow-packages">
              <WorkflowIcon size={12} /> Legal packages
            </Link>
            <button className="btn-action" onClick={() => openNew("unbc_affiliate_id_request")}>
              <WorkflowIcon size={12} /> UNBC example
            </button>
            <button className="btn-action" onClick={() => openNew("unbc_key_access_request")}>
              <WorkflowIcon size={12} /> Key request
            </button>
            <button className="btn-action" onClick={() => openNew("ote_keycard_access_request")}>
              <WorkflowIcon size={12} /> OTE access
            </button>
            <button className="btn-action" onClick={() => openNew("csj_remote_worker_orientation")}>
              <WorkflowIcon size={12} /> CSJ orientation
            </button>
            <button className="btn-action" onClick={() => openNew("agm_date_deadlines")}>
              <WorkflowIcon size={12} /> AGM deadlines
            </button>
            <button className="btn-action" onClick={() => openNew("filing_due_notify_officer")}>
              <WorkflowIcon size={12} /> Filing notice
            </button>
            <button className="btn-action" onClick={() => openNew("conflict_disclosed_agenda_item")}>
              <WorkflowIcon size={12} /> Conflict agenda
            </button>
            <button
              className="btn-action"
              disabled={setupBusy}
              onClick={async () => {
                setSetupBusy(true);
                try {
                  const result = await setupGovernanceN8nRecipes({
                    societyId: society._id,
                    actingUserId,
                  });
                  toast.success("n8n governance recipes linked", `${result.created.length} created, ${result.updated.length} updated`);
                } catch (error: any) {
                  toast.error("Could not link n8n recipes", error?.message);
                } finally {
                  setSetupBusy(false);
                }
              }}
            >
              <WorkflowIcon size={12} /> {setupBusy ? "Linking..." : "Link n8n recipes"}
            </button>
            <button className="btn-action btn-action--primary" onClick={() => openNew()}>
              <Plus size={12} /> New workflow
            </button>
          </>
        }
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="workflow" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="workflows"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(_, record) => navigate(`/app/workflows/${record._id}`)}
          onUpdate={async ({ recordId, fieldName, value }) => {
            // Only `name` and `status` are safe for inline edits — the
            // other visible columns are projected (recipeLabel,
            // triggerLabel) or Director-gated state (provider / run
            // timestamps). Provider switches go through
            // `updateProviderLink` from the canvas page.
            if (fieldName !== "name" && fieldName !== "status") return;
            const patch: any = {};
            patch[fieldName] = value;
            await update({
              id: recordId as Id<"workflows">,
              patch,
              actingUserId,
            });
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<WorkflowIcon size={14} />}
            label="Configured workflows"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || rows === undefined}
            renderRowActions={(r) => (
              <>
                <Link
                  className="btn btn--ghost btn--sm"
                  to={`/app/workflows/${r._id}`}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Open canvas for ${r.name}`}
                >
                  <ExternalLink size={12} /> Canvas
                </Link>
                <button
                  className="btn btn--ghost btn--sm"
                  disabled={busyId === r._id}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setBusyId(r._id);
                    try {
                      const result = await run({
                        societyId: society._id,
                        workflowId: r._id,
                        triggeredBy: "manual",
                        actingUserId,
                      });
                      toast.success(
                        result?.status === "running"
                          ? "Workflow queued in n8n"
                          : "Workflow run complete",
                      );
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
                  onClick={(e) => {
                    e.stopPropagation();
                    setStatus({
                      id: r._id,
                      status: r.status === "active" ? "paused" : "active",
                      actingUserId,
                    });
                  }}
                >
                  <Pause size={12} /> {r.status === "active" ? "Pause" : "Resume"}
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Remove ${r.name}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await remove({ id: r._id, actingUserId });
                    toast.success("Workflow removed");
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
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
                  const defaultTriggerKind = next?.config?.defaultTriggerKind;
                  const triggerKind =
                    defaultTriggerKind === "date_offset" || defaultTriggerKind === "cron" || defaultTriggerKind === "manual"
                      ? defaultTriggerKind
                      : next?.provider === "n8n"
                        ? "manual"
                        : form.triggerKind;
                  setForm({
                    ...form,
                    recipe: e.target.value,
                    name: next?.label ?? form.name,
                    provider: next?.provider ?? "internal",
                    triggerKind,
                    cron: triggerKind === "cron" ? (form.cron || "0 8 * * 1") : "",
                    daysBefore: next?.config?.daysBefore ? String(next.config.daysBefore) : form.daysBefore,
                    anchor: next?.config?.anchor ?? form.anchor,
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
            {catalog?.find((c) => c.key === form.recipe)?.config?.n8nOnly && (
              <div className="flag flag--info" style={{ marginBottom: 12 }}>
                <WorkflowIcon size={14} />
                <div>
                  This governance recipe is n8n-only. Societyer stores setup metadata, links the webhook,
                  and records callbacks; execution logic belongs in the imported n8n template.
                </div>
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
