import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
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

  if (society === undefined) return <PageLoading />;
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
            <MoreActionsMenu
              label="Templates"
              items={[
                {
                  id: "legal-packages",
                  label: "Legal packages",
                  icon: <WorkflowIcon size={14} />,
                  onSelect: () => navigate("/app/workflow-packages"),
                },
                {
                  id: "unbc-example",
                  label: "UNBC example",
                  icon: <WorkflowIcon size={14} />,
                  onSelect: () => openNew("unbc_affiliate_id_request"),
                },
                {
                  id: "key-request",
                  label: "Key request",
                  icon: <WorkflowIcon size={14} />,
                  onSelect: () => openNew("unbc_key_access_request"),
                },
                {
                  id: "ote-access",
                  label: "OTE access",
                  icon: <WorkflowIcon size={14} />,
                  onSelect: () => openNew("ote_keycard_access_request"),
                },
                {
                  id: "csj-orientation",
                  label: "CSJ orientation",
                  icon: <WorkflowIcon size={14} />,
                  onSelect: () => openNew("csj_remote_worker_orientation"),
                },
                {
                  id: "agm-deadlines",
                  label: "AGM deadlines",
                  icon: <WorkflowIcon size={14} />,
                  onSelect: () => openNew("agm_date_deadlines"),
                },
                {
                  id: "filing-notice",
                  label: "Filing notice",
                  icon: <WorkflowIcon size={14} />,
                  onSelect: () => openNew("filing_due_notify_officer"),
                },
                {
                  id: "conflict-agenda",
                  label: "Conflict agenda",
                  icon: <WorkflowIcon size={14} />,
                  onSelect: () => openNew("conflict_disclosed_agenda_item"),
                },
                {
                  id: "link-n8n-recipes",
                  label: setupBusy ? "Linking..." : "Link n8n recipes",
                  icon: <WorkflowIcon size={14} />,
                  disabled: setupBusy,
                  onSelect: async () => {
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
                  },
                },
              ]}
            />
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
              <Select
                value={form.recipe}
                onChange={(value) => {
                  const next = catalog?.find((c: any) => c.key === value);
                  const defaultTriggerKind = next?.config?.defaultTriggerKind;
                  const triggerKind =
                    defaultTriggerKind === "date_offset" || defaultTriggerKind === "cron" || defaultTriggerKind === "manual"
                      ? defaultTriggerKind
                      : next?.provider === "n8n"
                        ? "manual"
                        : form.triggerKind;
                  setForm({
                    ...form,
                    recipe: value,
                    name: next?.label ?? form.name,
                    provider: next?.provider ?? "internal",
                    triggerKind,
                    cron: triggerKind === "cron" ? (form.cron || "0 8 * * 1") : "",
                    daysBefore: next?.config?.daysBefore ? String(next.config.daysBefore) : form.daysBefore,
                    anchor: next?.config?.anchor ?? form.anchor,
                  });
                }}
                options={(catalog ?? []).map((c) => ({ value: c.key, label: c.label }))}
              />
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
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Provider">
              <input className="input" value={form.provider ?? "internal"} readOnly />
            </Field>
            <Field label="Trigger">
              <Select
                value={form.triggerKind}
                onChange={(value) => setForm({ ...form, triggerKind: value as TriggerKind })}
                options={[
                  { value: "cron", label: "Scheduled (cron)" },
                  { value: "date_offset", label: "Days before a date" },
                  { value: "manual", label: "Manual only" },
                ]}
              />
            </Field>
            {form.triggerKind === "cron" && (
              <Field label="Cron expression">
                <input
                  className="input mono"
                  value={form.cron}
                  onChange={(e) => setForm({ ...form, cron: e.target.value })}
                  placeholder="0 8 * * 1"
                />
              </Field>
            )}
            {form.triggerKind === "date_offset" && (
              <>
                <Field label="Anchor">
                  <Select
                    value={form.anchor}
                    onChange={(value) => setForm({ ...form, anchor: value })}
                    options={[
                      { value: "insurancePolicies.renewalDate", label: "Insurance renewal date" },
                      { value: "meetings.scheduledAt", label: "Meeting scheduled date" },
                      { value: "filings.dueDate", label: "Filing due date" },
                    ]}
                  />
                </Field>
                <Field label="Days before">
                  <input
                    className="input"
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
