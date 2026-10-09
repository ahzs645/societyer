import { isLocalDataRuntime } from "../lib/staticRuntime";
import { useDocumentTitle } from "../lib/documentTitle";
import { OrganizationOnboardingPanel } from "../components/OrganizationOnboardingPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { Badge, Drawer, Field } from "../components/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Modal } from "../components/Modal";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { PageLoading, SeedPrompt } from "./_helpers";
import { RecordNotFound } from "../components/RecordNotFound";
import { useRecordQuery } from "../hooks/useRecordQuery";
import {
  ArrowLeft,
  Bot,
  ClipboardList,
  ExternalLink,
  FileText,
  FormInput,
  History,
  Mail,
  Pause,
  Play,
  Plus,
  Power,
  Save,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import { formatDateTime } from "../lib/format";

import {
  FIELD_LABELS,
  nodeTypes,
  buildGraph,
  WorkflowNode,
  NodeIcon,
  nodeTypeLabel,
  checkboxLabel,
  slugifyFieldKey,
  inferIntakeFieldType,
  normalizeIntakeFields,
  uniqueFieldKey,
  configuredIntakeFields,
  initialIntakeValues,
  intakePayloadFromState,
  missingRequiredIntakeFields,
  AccessPersonPicker,
  documentDefaults,
  emailDefaults,
  workflowTemplateTokens,
  NodeSetupPanel,
  LabeledInput,
  LabeledTextarea,
  TemplateTextarea,
  FieldListEditor,
  DocumentCreateSetup,
  IntakeFieldSetup,
  IntakeFieldWizardModal,
  PdfFillSetup,
  PdfPickerModal,
  PdfPreviewPane,
  DYNAMIC_SOURCES,
  PERSON_SOURCES,
  MANAGER_SOURCES,
  PERSON_CATEGORIES,
  suggestMappingForField,
  mappingEqualsSuggestion,
  summariseMappings,
  KIND_LABEL,
  FieldMappingWizardModal,
  PersonRefPicker,
  FieldMappingEditor,
} from "./WorkflowDetail.internal";
import type {
  IntakeFieldType,
  IntakeField,
  TemplateToken,
  NodeSetupPanelProps,
  MappingKind,
  PersonCategory,
  FieldMapping,
} from "./WorkflowDetail.internal";

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  draft: "Draft",
};

const NODE_STATUS_LABELS: Record<string, string> = {
  ready: "Ready",
  needs_setup: "Needs setup",
  draft: "Draft",
};

function titleCase(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function WorkflowDetailPage() {
  const { id } = useParams();
  const society = useSociety();
  const canManage = usePermissions().can("tasks:write");
  const workflow = useRecordQuery<any>(api.workflows.get, id ? { id: id as any } : "skip");
  const runs = useQuery(api.workflows.runsForWorkflow, id && workflow ? { workflowId: id as any } : "skip");
  const catalog = useQuery(api.workflows.listCatalog, {});
  const nodeTypeCatalog = useQuery(api.workflows.listNodeTypes, {});
  const documents = useQuery(
    api.documents.list,
    society ? { societyId: society._id } : "skip",
  );
  const setStatus = useMutation(api.workflows.setStatus);
  const addNode = useMutation(api.workflows.addNode);
  const removeNode = useMutation(api.workflows.removeNode);
  const updateNodeConfig = useMutation(api.workflows.updateNodeConfig);
  const run = useAction(api.workflows.run);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const navigate = useNavigate();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [intake, setIntake] = useState<Record<string, any>>({});

  const recipe = catalog?.find((item: any) => item.key === workflow?.recipe);
  const preview = (workflow?.nodePreview?.length ? workflow.nodePreview : recipe?.nodePreview ?? []) as any[];
  const recipeNodeKeys = new Set<string>(
    (recipe?.nodePreview ?? []).map((node: any) => node.key),
  );
  const selectedNode = preview.find((node) => node.key === selectedKey) ?? preview[0];
  const isUserAddedNode = selectedNode ? !recipeNodeKeys.has(selectedNode.key) : false;
  const latestRun = runs?.[0];

  const graph = useMemo(() => buildGraph(preview), [preview]);
  useDocumentTitle(workflow?.name ? `${workflow.name} · Workflows` : null);

  if (society === undefined || workflow === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (!workflow) {
    return <RecordNotFound recordLabel="Workflow" backTo="/app/workflows" backLabel="All workflows" />;
  }

  const providerConfig = workflow.providerConfig ?? {};
  const sampleInput = workflow.config?.sampleInput ?? workflow.config?.sampleAffiliate ?? {};
  const intakeFields = configuredIntakeFields(workflow);
  const visibleIntakeFields = intakeFields.filter((field) => !field.isHidden);
  const launchUsesIntake = visibleIntakeFields.length > 0;

  const openIntake = () => {
    if (!canManage) return;
    setIntake(initialIntakeValues(intakeFields, sampleInput));
    setIntakeOpen(true);
  };

  const runWorkflow = async (input?: Record<string, unknown>) => {
    if (!canManage || busy) return;
    if (isLocalDataRuntime()) { toast.warn("Workflow execution requires a connected server"); return; }
    setBusy(true);
    try {
      const result = await run({
        societyId: society._id,
        workflowId: workflow._id,
        triggeredBy: "manual",
        input,
      });
      if (result?.status === "manual_required") toast.warn("Workflow preparation complete; manual actions remain");
      else toast.success(result?.status === "running" ? "Workflow queued in n8n; completion is pending" : "Workflow run complete");
      setIntakeOpen(false);
    } catch (error: any) {
      toast.error(error?.message ?? "Workflow run failed");
    } finally {
      setBusy(false);
    }
  };

  const isActive = workflow.status === "active";
  const statusLabel = WORKFLOW_STATUS_LABELS[workflow.status] ?? titleCase(workflow.status ?? "draft");
  const toggleStatus = () =>
    canManage && setStatus({
      id: workflow._id,
      status: isActive ? "paused" : "active",
    });
  const launch = () => (launchUsesIntake ? openIntake() : runWorkflow());
  const launchDisabled = !canManage || busy || !isActive || isLocalDataRuntime();
  // Phones get one primary action plus a ⋯ menu; five labelled buttons wrapped
  // onto two rows there.
  const phonePrimaryIsLaunch = isActive;
  const phoneMenuItems = [
    phonePrimaryIsLaunch
      ? { id: "status", label: "Pause", icon: <Pause size={14} />, disabled: !canManage || busy, onSelect: toggleStatus }
      : { id: "launch", label: "Launch", icon: <Play size={14} />, disabled: launchDisabled, onSelect: launch },
    { id: "runs", label: "See runs", icon: <History size={14} />, onSelect: () => navigate(`/app/workflow-runs?workflowId=${workflow._id}`) },
    { id: "add-node", label: "Add node", icon: <Plus size={14} />, disabled: !canManage, onSelect: () => { if (canManage) setAddOpen(true); } },
    {
      id: "n8n",
      label: "Open in n8n",
      icon: <ExternalLink size={14} />,
      disabled: !providerConfig.externalEditUrl,
      onSelect: () => { if (providerConfig.externalEditUrl) window.open(providerConfig.externalEditUrl, "_blank", "noreferrer"); },
    },
  ];

  return (
    <div className="workflow-detail">
      <div className="workflow-topbar">
        <div className="workflow-topbar__title">
          <Link to="/app/workflows" className="workflow-topbar__back" aria-label="Back to workflows" title="Back to workflows">
            <ArrowLeft size={14} />
          </Link>
          <div className="workflow-topbar__icon">
            <Settings size={16} />
          </div>
          <span>Workflows</span>
          <span className="muted">/</span>
          <h1 className="workflow-topbar__heading"><strong>{workflow.name}</strong></h1>
          <Badge tone={workflow.status === "active" ? "success" : workflow.status === "paused" ? "warn" : "neutral"}>
            {statusLabel}
          </Badge>
        </div>
        <div className="workflow-topbar__actions workflow-topbar__actions--phone">
          {phonePrimaryIsLaunch ? (
            <button className="btn btn--accent btn--sm" disabled={launchDisabled} onClick={launch}>
              <Play size={12} /> Launch
            </button>
          ) : (
            <button className="btn btn--accent btn--sm" disabled={!canManage || busy} onClick={toggleStatus}>
              <Power size={12} /> Activate
            </button>
          )}
          <MoreActionsMenu label="" items={phoneMenuItems} />
        </div>
        <div className="workflow-topbar__actions workflow-topbar__actions--desktop">
          <button
            className="btn btn--ghost btn--sm"
            disabled={!canManage || busy}
            onClick={toggleStatus}
          >
            {isActive ? <Pause size={12} /> : <Power size={12} />}
            {isActive ? "Pause" : "Activate"}
          </button>
          <button
            className="btn btn--ghost btn--sm"
            disabled={launchDisabled}
            onClick={launch}
          >
            <Play size={12} /> Launch
          </button>
          <Link className="btn btn--ghost btn--sm" to={`/app/workflow-runs?workflowId=${workflow._id}`}>
            <History size={12} /> See Runs
          </Link>
          <button
            className="btn btn--ghost btn--sm"
            disabled={!canManage}
            onClick={() => { if (canManage) setAddOpen(true); }}
            title="Insert a new step into this workflow"
          >
            <Plus size={12} /> Add Node
          </button>
          {providerConfig.externalEditUrl ? (
            <a className="btn btn--ghost btn--sm" href={providerConfig.externalEditUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Open in n8n
            </a>
          ) : (
            <button className="btn btn--ghost btn--sm" disabled>
              <ExternalLink size={12} /> Open in n8n
            </button>
          )}
        </div>
      </div>

      {workflow.recipe === "workspace_onboarding" && String(workflow.societyId) === String(society._id) && <OrganizationOnboardingPanel organization={society} />}
      {isLocalDataRuntime() && <p className="muted" style={{ padding: "8px 16px", margin: 0, fontSize: "var(--fs-sm)" }}>Running workflows needs a connected server; you can prepare and review this one here.</p>}
      <div className="workflow-shell">
        <section className="workflow-canvas" aria-label="Workflow canvas">
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_, node) => setSelectedKey(String(node.data.key))}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </section>
        {/* Phones: the canvas is too small to read, so list the steps in order. */}
        <ol className="workflow-steps-list" aria-label="Workflow steps">
          {preview.map((node, index) => (
            <li key={node.key}>
              <button
                type="button"
                className={`workflow-steps-list__item${selectedNode?.key === node.key ? " is-selected" : ""}`}
                aria-current={selectedNode?.key === node.key ? "step" : undefined}
                onClick={() => setSelectedKey(node.key)}
              >
                <span className="workflow-steps-list__index">{index + 1}</span>
                <NodeIcon type={node.type} />
                <span className="workflow-steps-list__text">
                  <span className="muted">{nodeTypeLabel(node.type)}</span>
                  <strong>{node.label}</strong>
                </span>
              </button>
            </li>
          ))}
        </ol>

        <aside className="workflow-sidepanel">
          {selectedNode ? (
            <>
              <div className="workflow-sidepanel__head">
                <NodeIcon type={selectedNode.type} />
                <div>
                  <div className="workflow-sidepanel__eyebrow">{nodeTypeLabel(selectedNode.type)}</div>
                  <h2>{selectedNode.label}</h2>
                </div>
              </div>
              <p className="muted">{selectedNode.description ?? "No description configured."}</p>
              <div className="workflow-sidepanel__section">
                <div className="field__label">Step setup</div>
                <span>
                  <Badge tone={selectedNode.status === "needs_setup" ? "warn" : selectedNode.status === "draft" ? "neutral" : "success"}>
                    {NODE_STATUS_LABELS[selectedNode.status ?? "ready"] ?? titleCase(String(selectedNode.status))}
                  </Badge>
                </span>
                {Array.isArray(selectedNode.setupIssues) && selectedNode.setupIssues.length > 0 && (
                  <ul className="workflow-setup-issues">
                    {selectedNode.setupIssues.map((issue: string) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
              {isUserAddedNode && (
                <div className="workflow-sidepanel__section">
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={!canManage}
                    onClick={async () => {
                      if (!canManage || !workflow) return;
                      await removeNode({
                        id: workflow._id,
                        key: selectedNode.key,
                      });
                      setSelectedKey(null);
                      toast.success("Node removed");
                    }}
                  >
                    <Trash2 size={12} /> Remove node
                  </button>
                </div>
              )}
              <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <NodeSetupPanel
                key={selectedNode.key}
                node={selectedNode}
                workflow={workflow}
                documents={documents ?? []}
                onLaunch={() => (launchUsesIntake ? openIntake() : runWorkflow())}
                launchDisabled={!canManage || busy || isLocalDataRuntime()}
                onSave={async (patch) => {
                  if (!canManage) return;
                  await updateNodeConfig({
                    id: workflow._id,
                    key: selectedNode.key,
                    config: patch,
                  });
                }}
              />
              </fieldset>
              <details className="workflow-sidepanel__section workflow-technical">
                <summary>Technical details</summary>
                <div className="field__label">Step key</div>
                <div className="mono">{selectedNode.key}</div>
                {workflow.provider && (
                  <>
                    <div className="field__label">Runs on</div>
                    <div>{workflow.provider === "n8n" ? "n8n automation engine" : "Societyer"}</div>
                  </>
                )}
                {workflow.provider === "n8n" && (
                  <>
                    <div className="field__label">Workflow-level n8n webhook</div>
                    <div className="workflow-codebox">{providerConfig.externalWebhookUrl ?? "Not configured"}</div>
                  </>
                )}
              </details>
            </>
          ) : (
            <div className="empty-state">Select a node to inspect it.</div>
          )}

          <div className="workflow-sidepanel__section">
            <div className="field__label">Latest run</div>
            {latestRun ? (
              <div className="workflow-run-mini">
                <Badge tone={latestRun.status === "success" ? "success" : latestRun.status === "failed" ? "danger" : "warn"}>
                  {titleCase(String(latestRun.status).replace(/_/g, " "))}
                </Badge>
                <span className="mono muted">{formatDateTime(latestRun.startedAtISO)}</span>
              </div>
            ) : (
              <div className="muted">No runs yet.</div>
            )}
          </div>
        </aside>
      </div>

      <Drawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add node"
      >
        <p className="muted" style={{ marginBottom: 12 }}>
          Pick a step type to append after{" "}
          <strong>{selectedNode?.label ?? "the last node"}</strong>. New nodes start
          as drafts — the runner will skip them until execution logic is wired in.
        </p>
        <div className="workflow-node-picker">
          {(nodeTypeCatalog ?? []).map((entry: any) => (
            <button
              key={entry.type}
              type="button"
              className="workflow-node-picker__item"
              disabled={!canManage || busy}
              onClick={async () => {
                if (!canManage || !workflow) return;
                setBusy(true);
                try {
                  const result = await addNode({
                    id: workflow._id,
                    node: {
                      type: entry.type,
                      label: entry.label,
                      description: entry.description,
                    },
                    afterKey: selectedNode?.key,
                  });
                  if (result?.key) setSelectedKey(result.key);
                  setAddOpen(false);
                  toast.success(`Added ${entry.label}`);
                } catch (err: any) {
                  toast.error(err?.message ?? "Could not add node");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <span className="workflow-node-picker__icon">
                <NodeIcon type={entry.type} />
              </span>
              <span className="workflow-node-picker__text">
                <strong>{entry.label}</strong>
                <span className="muted">{entry.description}</span>
              </span>
            </button>
          ))}
          {!nodeTypeCatalog && <div className="muted">Loading node types…</div>}
        </div>
      </Drawer>

      <Modal
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        title={`Launch ${workflow.name}`}
        size="lg"
        resizeKey="workflow-launch-intake"
        footer={
          <>
            <button className="btn" disabled={busy} onClick={() => setIntakeOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn--accent"
              disabled={!canManage || busy}
              onClick={() => {
                const missing = missingRequiredIntakeFields(intakeFields, intake);
                if (missing.length > 0) {
                  toast.error(`Fill required fields: ${missing.slice(0, 3).join(", ")}`);
                  return;
                }
                const payload = intakePayloadFromState(intakeFields, intake);
                runWorkflow({ intake: payload, affiliate: payload });
              }}
            >
              <Play size={12} /> Run workflow
            </button>
          </>
        }
      >
        <div className="workflow-intake">
          {visibleIntakeFields.map((field) => {
            return (
              <Field
                key={field.key}
                label={checkboxLabel(field.label)}
                hint={field.helpText}
                required={field.required}
              >
                {field.type === "checkbox" ? (
                  <label className="workflow-checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(intake[field.key])}
                      onChange={(event) => setIntake({ ...intake, [field.key]: event.target.checked })}
                    />
                    <span>{field.label}</span>
                  </label>
                ) : field.type === "textarea" ? (
                  <MarkdownEditor
                    rows={3}
                    value={intake[field.key] ?? ""}
                    onChange={(markdown) => setIntake({ ...intake, [field.key]: markdown })}
                  />
                ) : field.type === "person" ? (
                  <AccessPersonPicker
                    societyId={society._id}
                    field={field}
                    value={intake[field.key]}
                    onChange={(personValue) => {
                      setIntake({
                        ...intake,
                        [field.key]: personValue,
                        access_person_name: personValue?.name ?? "",
                        access_person_email: personValue?.email ?? "",
                        access_person_context: personValue?.role ? ` (${personValue.role})` : "",
                      });
                    }}
                  />
                ) : (
                  <input
                    className="input"
                    type={field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
                    value={intake[field.key] ?? ""}
                    onChange={(event) => setIntake({ ...intake, [field.key]: event.target.value })}
                  />
                )}
              </Field>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
