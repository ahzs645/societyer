import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { Badge, Drawer, Field } from "../components/ui";
import { Modal } from "../components/Modal";
import { SeedPrompt } from "./_helpers";
import {
  ArrowLeft,
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

const FIELD_LABELS = [
  "Legal First Name of Affiliate",
  "Legal Middle Name of Affiliate",
  "Legal Last Name of Affiliate",
  "Current Mailing Address",
  "Emergency Contact(Name and Ph)",
  "UNBC ID #",
  "Birthdate of Affiliate (MM/DD/YYYY)",
  "Personal email address",
  "Name of requesting Manager",
  "UNBC Department/Organization",
  "Length of Affiliate status(lf known)",
  "ManagerPhone",
  "Manager Email",
  "Authorizing Name (if different from Manager)",
  "Date signed",
  "Check Box0",
  "Check Box1",
];

const nodeTypes = {
  societyerWorkflowNode: WorkflowNode,
};

export function WorkflowDetailPage() {
  const { id } = useParams();
  const society = useSociety();
  const workflow = useQuery(api.workflows.get, id ? { id: id as any } : "skip");
  const runs = useQuery(api.workflows.runsForWorkflow, id ? { workflowId: id as any } : "skip");
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

  if (society === undefined || workflow === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;
  if (!workflow) {
    return (
      <div className="page workflow-detail">
        <Link className="btn btn--ghost" to="/app/workflows">
          <ArrowLeft size={12} /> Back to workflows
        </Link>
        <div className="empty-state">Workflow not found.</div>
      </div>
    );
  }

  const providerConfig = workflow.providerConfig ?? {};
  const sampleAffiliate = workflow.config?.sampleAffiliate ?? {};

  const openIntake = () => {
    setIntake({ ...sampleAffiliate });
    setIntakeOpen(true);
  };

  const runWorkflow = async (input?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const result = await run({
        societyId: society._id,
        workflowId: workflow._id,
        triggeredBy: "manual",
        actingUserId,
        input,
      });
      toast.success(result?.status === "running" ? "Workflow queued in n8n" : "Workflow run complete");
      setIntakeOpen(false);
    } catch (error: any) {
      toast.error(error?.message ?? "Workflow run failed");
    } finally {
      setBusy(false);
    }
  };

  const isUnbc = workflow.recipe === "unbc_affiliate_id_request";
  const isActive = workflow.status === "active";

  return (
    <div className="workflow-detail">
      <div className="workflow-topbar">
        <div className="workflow-topbar__title">
          <Link to="/app/workflows" className="workflow-topbar__back">
            <ArrowLeft size={14} />
          </Link>
          <div className="workflow-topbar__icon">
            <Settings size={16} />
          </div>
          <span>Workflows</span>
          <span className="muted">/</span>
          <strong>{workflow.name}</strong>
          <Badge tone={workflow.status === "active" ? "success" : workflow.status === "paused" ? "warn" : "neutral"}>
            {workflow.status}
          </Badge>
          {workflow.provider && <Badge tone={workflow.provider === "n8n" ? "info" : "neutral"}>{workflow.provider}</Badge>}
        </div>
        <div className="workflow-topbar__actions">
          <button
            className="btn btn--ghost btn--sm"
            disabled={busy}
            onClick={() =>
              setStatus({
                id: workflow._id,
                status: isActive ? "paused" : "active",
                actingUserId,
              })
            }
          >
            {isActive ? <Pause size={12} /> : <Power size={12} />}
            {isActive ? "Pause" : "Activate"}
          </button>
          <button
            className="btn btn--ghost btn--sm"
            disabled={busy}
            onClick={() => (isUnbc ? openIntake() : runWorkflow())}
          >
            <Play size={12} /> Test
          </button>
          <Link className="btn btn--ghost btn--sm" to={`/app/workflow-runs?workflowId=${workflow._id}`}>
            <History size={12} /> See Runs
          </Link>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setAddOpen(true)}
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
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="workflow-status-chip">
            <Badge tone={workflow.status === "active" ? "success" : "warn"}>
              {workflow.status === "active" ? "Active" : "Draft"}
            </Badge>
          </div>
        </section>

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
                <div className="field__label">Node key</div>
                <div className="mono">{selectedNode.key}</div>
              </div>
              <div className="workflow-sidepanel__section">
                <div className="field__label">Status</div>
                <Badge tone={selectedNode.status === "needs_setup" ? "warn" : selectedNode.status === "draft" ? "neutral" : "success"}>
                  {selectedNode.status ?? "ready"}
                </Badge>
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
                    onClick={async () => {
                      if (!workflow) return;
                      await removeNode({
                        id: workflow._id,
                        key: selectedNode.key,
                        actingUserId,
                      });
                      setSelectedKey(null);
                      toast.success("Node removed");
                    }}
                  >
                    <Trash2 size={12} /> Remove node
                  </button>
                </div>
              )}
              <NodeSetupPanel
                key={selectedNode.key}
                node={selectedNode}
                workflow={workflow}
                documents={documents ?? []}
                onSave={async (patch) => {
                  await updateNodeConfig({
                    id: workflow._id,
                    key: selectedNode.key,
                    config: patch,
                    actingUserId,
                  });
                }}
              />
              {workflow.provider === "n8n" && (
                <div className="workflow-sidepanel__section">
                  <div className="field__label">Workflow-level n8n webhook</div>
                  <div className="workflow-codebox">{providerConfig.externalWebhookUrl ?? "Not configured"}</div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">Select a node to inspect it.</div>
          )}

          <div className="workflow-sidepanel__section">
            <div className="field__label">Latest run</div>
            {latestRun ? (
              <div className="workflow-run-mini">
                <Badge tone={latestRun.status === "success" ? "success" : latestRun.status === "failed" ? "danger" : "warn"}>
                  {latestRun.status}
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
              disabled={busy}
              onClick={async () => {
                if (!workflow) return;
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
                    actingUserId,
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

      <Drawer
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        title="Affiliate intake"
        footer={
          <>
            <button className="btn" disabled={busy} onClick={() => setIntakeOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" disabled={busy} onClick={() => runWorkflow({ affiliate: intake })}>
              <Play size={12} /> Run in n8n
            </button>
          </>
        }
      >
        <div className="workflow-intake">
          {FIELD_LABELS.map((field) => {
            const isCheckbox = field === "Check Box0" || field === "Check Box1";
            return (
              <Field key={field} label={checkboxLabel(field)}>
                {isCheckbox ? (
                  <label className="workflow-checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(intake[field])}
                      onChange={(event) => setIntake({ ...intake, [field]: event.target.checked })}
                    />
                    <span>{field === "Check Box0" ? "Previous UNBC ID: yes" : "Previous UNBC ID: no"}</span>
                  </label>
                ) : (
                  <input
                    className="input"
                    value={intake[field] ?? ""}
                    onChange={(event) => setIntake({ ...intake, [field]: event.target.value })}
                  />
                )}
              </Field>
            );
          })}
        </div>
      </Drawer>
    </div>
  );
}

function buildGraph(preview: any[]): { nodes: Node[]; edges: Edge[] } {
  const nodes = preview.map((node, index) => ({
    id: node.key,
    type: "societyerWorkflowNode",
    position: {
      x: index % 2 === 0 ? 0 : 128,
      y: index * 152,
    },
    data: node,
  }));
  const edges = preview.slice(0, -1).map((node, index) => ({
    id: `${node.key}-${preview[index + 1].key}`,
    source: node.key,
    target: preview[index + 1].key,
    type: "smoothstep",
    animated: false,
    style: { stroke: "var(--border-strong)", strokeWidth: 1.5 },
  }));
  return { nodes, edges };
}

function WorkflowNode({ data }: NodeProps) {
  const node = data as any;
  return (
    <div className="workflow-node">
      <Handle type="target" position={Position.Top} />
      <div className="workflow-node__icon">
        <NodeIcon type={node.type} />
      </div>
      <div className="workflow-node__text">
        <div className="workflow-node__kind">{nodeTypeLabel(node.type)}</div>
        <div className="workflow-node__label">{node.label}</div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function NodeIcon({ type }: { type: string }) {
  const props = { size: 16 };
  switch (type) {
    case "manual_trigger":
      return <UserPlus {...props} />;
    case "form":
      return <FormInput {...props} />;
    case "pdf_fill":
      return <FileText {...props} />;
    case "document_create":
      return <Save {...props} />;
    case "email":
      return <Mail {...props} />;
    default:
      return <ClipboardList {...props} />;
  }
}

function nodeTypeLabel(type: string) {
  switch (type) {
    case "manual_trigger":
      return "Trigger";
    case "form":
      return "Form";
    case "pdf_fill":
      return "PDF";
    case "document_create":
      return "Document";
    case "email":
      return "Notification";
    default:
      return "Action";
  }
}

function checkboxLabel(field: string) {
  if (field === "Check Box0") return "Previous UNBC ID - yes";
  if (field === "Check Box1") return "Previous UNBC ID - no";
  return field;
}

type NodeSetupPanelProps = {
  node: any;
  workflow: any;
  documents: any[];
  onSave: (patch: Record<string, any>) => Promise<void>;
};

function NodeSetupPanel({ node, workflow, documents, onSave }: NodeSetupPanelProps) {
  const cfg = node.config ?? {};
  const recipeCfg = workflow?.config ?? {};

  const blurbs: Record<string, string> = {
    manual_trigger: "A person starts this workflow from inside Societyer. No external setup required.",
    form: "Collects structured input before handing off to later steps. Define the fields to collect.",
    pdf_fill: "Picks up a fillable PDF from Documents, fills mapped AcroForm fields, and saves the output as a new document version.",
    document_create: "Saves the output of a prior step into Documents with a category and retention policy.",
    email: "Sends a templated email via Resend. Will be skipped until Resend is configured on the server.",
    external_n8n: "Hands execution to an n8n workflow via its webhook URL. n8n then calls back to progress the timeline.",
  };

  return (
    <div className="workflow-sidepanel__section workflow-setup">
      <div className="field__label">Setup</div>
      <p className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 8 }}>
        {blurbs[node.type] ?? "No setup options for this node type."}
      </p>

      {node.type === "manual_trigger" && (
        <LabeledInput
          label="Trigger label"
          value={cfg.launchLabel ?? ""}
          placeholder="Launch"
          onSave={(v) => onSave({ launchLabel: v })}
        />
      )}

      {node.type === "form" && (
        <FieldListEditor
          label="Intake fields"
          hint="One field per line. Saved when focus leaves the box."
          value={Array.isArray(cfg.fields) ? cfg.fields : []}
          onSave={(fields) => onSave({ fields })}
        />
      )}

      {node.type === "pdf_fill" && (
        <PdfFillSetup
          node={node}
          cfg={cfg}
          documents={documents}
          recipeFields={Array.isArray(recipeCfg.pdfFields) ? recipeCfg.pdfFields : []}
          onSave={onSave}
        />
      )}

      {node.type === "document_create" && (
        <>
          <LabeledInput
            label="Category"
            value={cfg.category ?? ""}
            placeholder="WorkflowGenerated"
            onSave={(v) => onSave({ category: v })}
          />
          <LabeledInput
            label="Tags (comma-separated)"
            value={(Array.isArray(cfg.tags) ? cfg.tags : []).join(", ")}
            placeholder="workflow-generated, unbc-affiliate-id"
            onSave={(v) =>
              onSave({
                tags: v
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
          />
        </>
      )}

      {node.type === "email" && (
        <>
          <LabeledInput
            label="To"
            value={cfg.to ?? ""}
            placeholder="recipient@example.com"
            onSave={(v) => onSave({ to: v })}
          />
          <LabeledInput
            label="Subject"
            value={cfg.subject ?? ""}
            placeholder="UNBC affiliate ID ready for review"
            onSave={(v) => onSave({ subject: v })}
          />
          <LabeledTextarea
            label="Body"
            value={cfg.body ?? ""}
            placeholder="Hi {{manager}}, the affiliate request for {{affiliate}} is ready for your signature."
            onSave={(v) => onSave({ body: v })}
          />
        </>
      )}

      {node.type === "external_n8n" && (
        <>
          <LabeledInput
            label="Webhook URL override"
            value={cfg.webhookUrl ?? ""}
            placeholder={workflow?.providerConfig?.externalWebhookUrl ?? "https://n8n.example.com/webhook/..."}
            onSave={(v) => onSave({ webhookUrl: v })}
          />
          <LabeledInput
            label="n8n node name"
            value={cfg.nodeName ?? ""}
            placeholder="Fill UNBC ID PDF"
            onSave={(v) => onSave({ nodeName: v })}
          />
        </>
      )}

      <div className="workflow-setup__footer">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Test harness ships with Phase 2 — executing nodes individually."
        >
          <Play size={12} /> Test node
        </button>
        <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          Runner support for user-edited nodes is staged; config saved here will wire in once execution lands.
        </span>
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  // Reset local draft when the parent value changes (e.g. selecting a different node).
  const lastExternal = useRef(value);
  if (lastExternal.current !== value) {
    lastExternal.current = value;
    if (draft !== value) setDraft(value);
  }
  return (
    <Field label={label}>
      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
      />
    </Field>
  );
}

function LabeledTextarea({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const lastExternal = useRef(value);
  if (lastExternal.current !== value) {
    lastExternal.current = value;
    if (draft !== value) setDraft(value);
  }
  return (
    <Field label={label}>
      <textarea
        className="textarea"
        value={draft}
        placeholder={placeholder}
        rows={4}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
      />
    </Field>
  );
}

function FieldListEditor({
  label,
  hint,
  value,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string[];
  onSave: (next: string[]) => void | Promise<void>;
}) {
  const asText = value.join("\n");
  const [draft, setDraft] = useState(asText);
  const lastExternal = useRef(asText);
  if (lastExternal.current !== asText) {
    lastExternal.current = asText;
    if (draft !== asText) setDraft(asText);
  }
  return (
    <Field label={label}>
      <textarea
        className="textarea"
        rows={5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          if (next.join("\n") !== value.join("\n")) onSave(next);
        }}
      />
      {hint && (
        <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </Field>
  );
}

function PdfFillSetup({
  node,
  cfg,
  documents,
  recipeFields,
  onSave,
}: {
  node: any;
  cfg: Record<string, any>;
  documents: any[];
  recipeFields: string[];
  onSave: (patch: Record<string, any>) => Promise<void>;
}) {
  const pdfs = (documents ?? []).filter(
    (doc: any) => doc.mimeType === "application/pdf" || /\.pdf$/i.test(doc.fileName ?? ""),
  );
  const selectedDoc = pdfs.find((doc: any) => doc._id === cfg.templateDocumentId);
  const currentFields: string[] = Array.isArray(cfg.fields) && cfg.fields.length > 0
    ? cfg.fields
    : recipeFields;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mapperOpen, setMapperOpen] = useState(false);

  const mappings: Record<string, any> = (cfg.fieldMappings && typeof cfg.fieldMappings === "object")
    ? cfg.fieldMappings
    : {};
  const mappingSummary = summariseMappings(currentFields, mappings);

  return (
    <>
      <Field label="PDF template">
        <div className="pdf-picker-trigger">
          <div className="pdf-picker-trigger__label">
            {selectedDoc ? (
              <>
                <strong>{selectedDoc.title ?? selectedDoc.fileName}</strong>
                {selectedDoc.fileName && selectedDoc.fileName !== selectedDoc.title && (
                  <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    {selectedDoc.fileName}
                  </span>
                )}
              </>
            ) : (
              <span className="muted">No template selected.</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setPickerOpen(true)}
            >
              {selectedDoc ? "Change template" : "Browse PDFs"}
            </button>
            {selectedDoc && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onSave({ templateDocumentId: undefined })}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {pdfs.length === 0 && (
          <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
            Upload a fillable PDF in <span className="mono">/app/documents</span> to see it here.
          </div>
        )}
      </Field>

      <PdfPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        pdfs={pdfs}
        selectedId={cfg.templateDocumentId}
        onPick={async (id) => {
          await onSave({ templateDocumentId: id });
          setPickerOpen(false);
        }}
      />

      <Field label="Field mapping">
        <div className="pdf-picker-trigger">
          <div className="pdf-picker-trigger__label">
            <strong>
              {mappingSummary.mapped} of {mappingSummary.total} fields mapped
            </strong>
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              {mappingSummary.mapped === 0
                ? "Open the wizard to map each AcroForm field to a value."
                : mappingSummary.breakdown}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setMapperOpen(true)}
          >
            {mappingSummary.mapped === 0 ? "Start mapping" : "Edit mapping"}
          </button>
        </div>
      </Field>

      <FieldMappingWizardModal
        open={mapperOpen}
        onClose={() => setMapperOpen(false)}
        fields={currentFields}
        mappings={mappings}
        onFieldsChange={(fields) => onSave({ fields })}
        onMappingsChange={(next) => onSave({ fieldMappings: next })}
      />

      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled
          title="Auto-detection reads AcroForm field names from the selected PDF. Coming in Phase 2."
        >
          Auto-detect fields
        </button>
      </div>
    </>
  );
}

// Full-screen picker with a left list + right preview iframe.
function PdfPickerModal({
  open,
  onClose,
  pdfs,
  selectedId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  pdfs: any[];
  selectedId?: string;
  onPick: (id: string) => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [focusedId, setFocusedId] = useState<string | undefined>(selectedId);

  useEffect(() => {
    if (open) setFocusedId(selectedId);
  }, [open, selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pdfs;
    return pdfs.filter((doc: any) =>
      [doc.title, doc.fileName, doc.category]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [search, pdfs]);

  const focused = filtered.find((d: any) => d._id === focusedId) ?? filtered[0];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Select a fillable PDF template"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--accent"
            disabled={!focused}
            onClick={() => focused && onPick(focused._id)}
          >
            Select template
          </button>
        </>
      }
    >
      <div className="pdf-picker">
        <aside className="pdf-picker__list">
          <input
            className="input"
            placeholder="Search title, filename, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="pdf-picker__items">
            {filtered.length === 0 && (
              <div className="muted" style={{ padding: 12 }}>
                No PDFs match.
              </div>
            )}
            {filtered.map((doc: any) => (
              <button
                key={doc._id}
                type="button"
                className={`pdf-picker__item${
                  focused && focused._id === doc._id ? " is-active" : ""
                }`}
                onClick={() => setFocusedId(doc._id)}
                onDoubleClick={() => onPick(doc._id)}
              >
                <strong>{doc.title ?? doc.fileName}</strong>
                {doc.fileName && doc.fileName !== doc.title && (
                  <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    {doc.fileName}
                  </span>
                )}
                {doc.category && (
                  <span className="cell-tag" style={{ alignSelf: "flex-start" }}>
                    {doc.category}
                  </span>
                )}
              </button>
            ))}
          </div>
        </aside>
        <section className="pdf-picker__preview">
          {focused ? (
            <PdfPreviewPane doc={focused} />
          ) : (
            <div className="muted" style={{ padding: 24 }}>
              Pick a document on the left to preview it here.
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function PdfPreviewPane({ doc }: { doc: any }) {
  const latest = useQuery(api.documentVersions.latest, { documentId: doc._id });
  const getDownloadUrl = useAction(api.documentVersions.getDownloadUrl);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!latest?._id) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await getDownloadUrl({ versionId: latest._id });
        if (!cancelled) setUrl(next ?? null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Unable to load preview.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latest?._id, getDownloadUrl]);

  return (
    <div className="pdf-preview">
      <div className="pdf-preview__meta">
        <strong>{doc.title ?? doc.fileName}</strong>
        <div className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
          {doc.fileName ?? "—"} · {doc.category ?? "—"}
        </div>
      </div>
      <div className="pdf-preview__frame">
        {error && (
          <div className="muted" style={{ padding: 16 }}>
            {error}
          </div>
        )}
        {!error && url && (
          <iframe title="PDF preview" src={url} className="pdf-preview__iframe" />
        )}
        {!error && !url && latest?._id && (
          <div className="muted" style={{ padding: 16 }}>
            Loading preview…
          </div>
        )}
        {!error && !latest?._id && (
          <div className="muted" style={{ padding: 16 }}>
            No file attached to this document yet.
          </div>
        )}
      </div>
    </div>
  );
}

type MappingKind = "literal" | "dynamic" | "person" | "personRef" | "manager" | "empty";

type PersonCategory = "members" | "directors" | "volunteers" | "employees";

type FieldMapping = {
  kind: MappingKind;
  // literal/default text
  value?: string;
  // dynamic: "today" | "today:long" | "now" | "society.name" | ...
  // person/manager/personRef: "firstName" | "lastName" | "email" | "custom:<key>" | ...
  source?: string;
  // personRef-specific: which category + which person
  category?: PersonCategory;
  personId?: string;
};

const DYNAMIC_SOURCES: Array<{ value: string; label: string }> = [
  { value: "today", label: "Today (YYYY-MM-DD)" },
  { value: "today:long", label: "Today (Apr 20, 2026)" },
  { value: "now", label: "Now (ISO timestamp)" },
  { value: "society.name", label: "Society name" },
  { value: "currentUser.name", label: "Current user name" },
  { value: "currentUser.email", label: "Current user email" },
];

const PERSON_SOURCES: Array<{ value: string; label: string }> = [
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "mailingAddress", label: "Mailing address" },
  { value: "birthdate", label: "Birthdate" },
];

const MANAGER_SOURCES: Array<{ value: string; label: string }> = [
  { value: "name", label: "Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "department", label: "Department / Organization" },
];

const PERSON_CATEGORIES: Array<{ value: PersonCategory; label: string }> = [
  { value: "members", label: "Members" },
  { value: "directors", label: "Directors" },
  { value: "volunteers", label: "Volunteers" },
  { value: "employees", label: "Employees" },
];

// Heuristic: given a raw PDF AcroForm field name, guess a sensible mapping.
// Returns null if nothing confident — the user sees "Empty" and picks manually.
function suggestMappingForField(fieldName: string): FieldMapping | null {
  const norm = fieldName.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
  const contains = (needle: string) => norm.includes(needle);
  const match = (re: RegExp) => re.test(norm);

  // Date signed / signature date / date of signature
  if (match(/(date.*sign|sign.*date|signature.*date)/)) {
    return { kind: "dynamic", source: "today" };
  }
  // Society / organization's own name
  if (match(/society.*name|organization.*name\b/) && !contains("manager")) {
    return { kind: "dynamic", source: "society.name" };
  }
  // Manager/authorizer block — must run BEFORE the generic person matchers.
  if (contains("manager") || contains("authoriz")) {
    if (match(/(email|e-?mail)/)) return { kind: "manager", source: "email" };
    if (match(/(phone|tel)/)) return { kind: "manager", source: "phone" };
    if (match(/(department|organization|org|dept)/)) {
      return { kind: "manager", source: "department" };
    }
    if (match(/(name|authoriz)/)) return { kind: "manager", source: "name" };
  }
  // Emergency contact — leave empty, the user probably wants a literal.
  if (contains("emergency")) return null;
  // Person/affiliate fields (runtime input from the workflow form).
  if (match(/\bfirst\b.*\bname\b/) || match(/\bfirst.?name\b/) || match(/\bgiven.?name\b/)) {
    return { kind: "person", source: "firstName" };
  }
  if (match(/\bmiddle\b.*\bname\b/)) {
    // No middle-name source — fallback to empty so the user notices.
    return null;
  }
  if (match(/\blast\b.*\bname\b/) || match(/\blast.?name\b/) || match(/\bsurname\b/) || match(/\bfamily.?name\b/)) {
    return { kind: "person", source: "lastName" };
  }
  if (match(/(birth.?date|date.*birth|\bdob\b)/)) {
    return { kind: "person", source: "birthdate" };
  }
  if (match(/(personal.*email|e-?mail.*address|^email$|\bemail\b)/)) {
    return { kind: "person", source: "email" };
  }
  if (match(/(mailing.*address|home.*address|current.*address|^address$|\baddress\b)/)) {
    return { kind: "person", source: "mailingAddress" };
  }
  if (match(/(phone|tel|mobile|cell)/)) {
    return { kind: "person", source: "phone" };
  }
  // Check boxes — leave empty.
  if (match(/^check\s*box/)) return null;
  return null;
}

function mappingEqualsSuggestion(a: FieldMapping | undefined, b: FieldMapping | null): boolean {
  if (!a || !b) return false;
  return a.kind === b.kind && (a.source ?? "") === (b.source ?? "") && (a.value ?? "") === (b.value ?? "");
}

function summariseMappings(fields: string[], mappings: Record<string, FieldMapping>) {
  const total = fields.length;
  let mapped = 0;
  const counts: Record<MappingKind, number> = {
    literal: 0,
    dynamic: 0,
    person: 0,
    personRef: 0,
    manager: 0,
    empty: 0,
  };
  for (const field of fields) {
    const m = mappings[field];
    if (!m || m.kind === "empty") continue;
    if (m.kind === "literal" && !(m.value ?? "").trim()) continue;
    if ((m.kind === "dynamic" || m.kind === "person" || m.kind === "manager") && !m.source) continue;
    if (m.kind === "personRef" && (!m.category || !m.personId || !m.source)) continue;
    counts[m.kind] += 1;
    mapped += 1;
  }
  const parts: string[] = [];
  if (counts.literal) parts.push(`${counts.literal} literal`);
  if (counts.dynamic) parts.push(`${counts.dynamic} dynamic`);
  if (counts.person) parts.push(`${counts.person} person`);
  if (counts.personRef) parts.push(`${counts.personRef} record`);
  if (counts.manager) parts.push(`${counts.manager} manager`);
  const breakdown = parts.length > 0 ? parts.join(" · ") : "No mappings yet.";
  return { total, mapped, breakdown };
}

const KIND_LABEL: Record<MappingKind, string> = {
  empty: "Empty",
  literal: "Literal",
  dynamic: "Dynamic",
  person: "Person",
  personRef: "Person record",
  manager: "Manager",
};

function FieldMappingWizardModal({
  open,
  onClose,
  fields,
  mappings,
  onFieldsChange,
  onMappingsChange,
}: {
  open: boolean;
  onClose: () => void;
  fields: string[];
  mappings: Record<string, FieldMapping>;
  onFieldsChange: (fields: string[]) => void | Promise<void>;
  onMappingsChange: (next: Record<string, FieldMapping>) => void | Promise<void>;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [newField, setNewField] = useState("");

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open, fields.length]);

  const safeIndex = Math.min(stepIndex, Math.max(0, fields.length - 1));
  const currentField = fields[safeIndex];
  const current: FieldMapping = mappings[currentField] ?? { kind: "empty" };

  const summary = summariseMappings(fields, mappings);

  const updateMapping = (patch: Partial<FieldMapping>) => {
    if (!currentField) return;
    const existing = mappings[currentField] ?? { kind: "empty" as MappingKind };
    const next = { ...mappings, [currentField]: { ...existing, ...patch } };
    onMappingsChange(next);
  };

  const pickKind = (kind: MappingKind) => {
    if (!currentField) return;
    const next = {
      ...mappings,
      [currentField]: { kind, value: undefined, source: undefined } as FieldMapping,
    };
    onMappingsChange(next);
  };

  const removeField = (field: string) => {
    const nextFields = fields.filter((f) => f !== field);
    onFieldsChange(nextFields);
    if (mappings[field]) {
      const { [field]: _drop, ...rest } = mappings;
      onMappingsChange(rest);
    }
    setStepIndex((i) => Math.max(0, Math.min(i, nextFields.length - 1)));
  };

  const addField = () => {
    const name = newField.trim();
    if (!name || fields.includes(name)) return;
    onFieldsChange([...fields, name]);
    const suggestion = suggestMappingForField(name);
    if (suggestion) {
      onMappingsChange({ ...mappings, [name]: suggestion });
    }
    setNewField("");
    setStepIndex(fields.length); // jump to the newly added one
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Map PDF fields"
      footer={
        <>
          <div className="muted" style={{ marginRight: "auto", fontSize: "var(--fs-sm)" }}>
            {summary.mapped} of {summary.total} mapped · {summary.breakdown}
          </div>
          <button
            className="btn"
            title="Apply the heuristic suggestion to every field that's currently empty."
            onClick={() => {
              const next = { ...mappings };
              let applied = 0;
              for (const field of fields) {
                const existing = next[field];
                const isEmpty =
                  !existing ||
                  existing.kind === "empty" ||
                  (existing.kind === "literal" && !(existing.value ?? "").trim()) ||
                  ((existing.kind === "dynamic" || existing.kind === "person" || existing.kind === "manager") && !existing.source);
                if (!isEmpty) continue;
                const suggestion = suggestMappingForField(field);
                if (!suggestion) continue;
                next[field] = suggestion;
                applied += 1;
              }
              if (applied > 0) onMappingsChange(next);
            }}
          >
            Auto-fill empty fields
          </button>
          <button
            className="btn"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={safeIndex <= 0}
          >
            Previous
          </button>
          <button
            className="btn"
            onClick={() => setStepIndex((i) => Math.min(fields.length - 1, i + 1))}
            disabled={safeIndex >= fields.length - 1}
          >
            Next
          </button>
          <button className="btn btn--accent" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="mapping-wizard">
        <aside className="mapping-wizard__sidebar">
          <div className="field__label">Fields</div>
          <div className="mapping-wizard__list">
            {fields.length === 0 && (
              <div className="muted" style={{ padding: 8, fontSize: "var(--fs-sm)" }}>
                No fields yet. Add one below.
              </div>
            )}
            {fields.map((field, idx) => {
              const m = mappings[field];
              const isDone =
                m &&
                m.kind !== "empty" &&
                !(m.kind === "literal" && !(m.value ?? "").trim()) &&
                !((m.kind === "dynamic" || m.kind === "person" || m.kind === "manager") && !m.source);
              return (
                <button
                  key={field}
                  type="button"
                  className={`mapping-wizard__item${idx === safeIndex ? " is-active" : ""}`}
                  onClick={() => setStepIndex(idx)}
                >
                  <span className="mapping-wizard__item-label mono">{field}</span>
                  <span
                    className={`mapping-wizard__item-badge${isDone ? " is-done" : ""}`}
                    aria-label={isDone ? "Mapped" : "Not yet mapped"}
                  >
                    {isDone ? KIND_LABEL[m.kind] : "—"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mapping-wizard__add">
            <input
              className="input"
              placeholder="Add field name"
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addField();
                }
              }}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={addField}
              disabled={!newField.trim()}
            >
              <Plus size={12} /> Add
            </button>
          </div>
        </aside>

        <section className="mapping-wizard__main">
          {!currentField ? (
            <div className="muted" style={{ padding: 16 }}>
              Add a PDF field in the sidebar to start mapping.
            </div>
          ) : (
            <>
              <div className="mapping-wizard__stepper muted" style={{ fontSize: "var(--fs-xs)" }}>
                Field {safeIndex + 1} of {fields.length}
              </div>
              <h3 className="mapping-wizard__field mono">{currentField}</h3>

              {(() => {
                const suggestion = suggestMappingForField(currentField);
                if (!suggestion) return null;
                const label =
                  suggestion.kind === "dynamic"
                    ? `Dynamic · ${DYNAMIC_SOURCES.find((s) => s.value === suggestion.source)?.label ?? suggestion.source}`
                    : suggestion.kind === "person"
                      ? `Person · ${PERSON_SOURCES.find((s) => s.value === suggestion.source)?.label ?? suggestion.source}`
                      : suggestion.kind === "manager"
                        ? `Manager · ${MANAGER_SOURCES.find((s) => s.value === suggestion.source)?.label ?? suggestion.source}`
                        : suggestion.kind === "literal"
                          ? `Literal · "${suggestion.value ?? ""}"`
                          : suggestion.kind;
                const already = mappingEqualsSuggestion(current, suggestion);
                return (
                  <div className="mapping-wizard__suggestion">
                    <span
                      className={`mapping-wizard__suggestion-badge${already ? " is-applied" : ""}`}
                    >
                      {already ? "Suggestion applied" : "Suggested"}
                    </span>
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                      {label}
                    </span>
                    {!already && (
                      <button
                        type="button"
                        className="btn btn--accent btn--sm"
                        onClick={() => {
                          onMappingsChange({ ...mappings, [currentField]: suggestion });
                        }}
                      >
                        Apply
                      </button>
                    )}
                  </div>
                );
              })()}

              <div className="field__label">Source</div>
              <div className="mapping-wizard__kinds">
                {(["literal", "dynamic", "person", "personRef", "manager", "empty"] as MappingKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`mapping-wizard__kind${current.kind === k ? " is-active" : ""}`}
                    onClick={() => pickKind(k)}
                  >
                    <strong>{KIND_LABEL[k]}</strong>
                    <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                      {
                        {
                          literal: "A default string you type in",
                          dynamic: "Today / Now / society name etc.",
                          person: "Field from the affiliate (runtime input)",
                          personRef: "Specific person record (director, member, …)",
                          manager: "Field from the requesting manager",
                          empty: "Leave blank at runtime",
                        }[k]
                      }
                    </span>
                  </button>
                ))}
              </div>

              <div className="field__label" style={{ marginTop: 16 }}>
                Value
              </div>
              <div className="mapping-wizard__value">
                {current.kind === "literal" && (
                  <input
                    className="input"
                    value={current.value ?? ""}
                    placeholder="Default value"
                    onChange={(e) => updateMapping({ value: e.target.value })}
                  />
                )}
                {current.kind === "dynamic" && (
                  <select
                    className="input"
                    value={current.source ?? ""}
                    onChange={(e) => updateMapping({ source: e.target.value })}
                  >
                    <option value="">— Pick token —</option>
                    {DYNAMIC_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {current.kind === "person" && (
                  <select
                    className="input"
                    value={current.source ?? ""}
                    onChange={(e) => updateMapping({ source: e.target.value })}
                  >
                    <option value="">— Pick person field —</option>
                    {PERSON_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {current.kind === "personRef" && (
                  <PersonRefPicker
                    category={current.category}
                    personId={current.personId}
                    source={current.source}
                    onChange={(patch) => updateMapping(patch)}
                  />
                )}
                {current.kind === "manager" && (
                  <select
                    className="input"
                    value={current.source ?? ""}
                    onChange={(e) => updateMapping({ source: e.target.value })}
                  >
                    <option value="">— Pick manager field —</option>
                    {MANAGER_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {current.kind === "empty" && (
                  <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    This field will be left blank at runtime.
                  </span>
                )}
              </div>

              <div className="mapping-wizard__row-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => removeField(currentField)}
                >
                  <Trash2 size={12} /> Remove field
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}

function PersonRefPicker({
  category,
  personId,
  source,
  onChange,
}: {
  category?: PersonCategory;
  personId?: string;
  source?: string;
  onChange: (patch: Partial<FieldMapping>) => void;
}) {
  const society = useSociety();
  const societyArg = society ? { societyId: society._id } : "skip";
  const members = useQuery(api.members.list, category === "members" ? societyArg : "skip");
  const directors = useQuery(api.directors.list, category === "directors" ? societyArg : "skip");
  const volunteers = useQuery(api.volunteers.list, category === "volunteers" ? societyArg : "skip");
  const employees = useQuery(api.employees.list, category === "employees" ? societyArg : "skip");
  const definitions = useQuery(
    api.customFields.listDefinitions,
    society && category ? { societyId: society._id, entityType: category } : "skip",
  );

  const peopleRaw: any[] =
    category === "members"
      ? members ?? []
      : category === "directors"
        ? directors ?? []
        : category === "volunteers"
          ? volunteers ?? []
          : category === "employees"
            ? employees ?? []
            : [];

  const displayName = (p: any) => {
    const first = p.firstName ?? "";
    const last = p.lastName ?? "";
    const full = `${first} ${last}`.trim();
    return full || p.name || p.email || "Unnamed";
  };

  const fieldOptionsFor = (cat?: PersonCategory) => {
    const base: Array<{ value: string; label: string }> = [
      { value: "firstName", label: "First name" },
      { value: "lastName", label: "Last name" },
      { value: "fullName", label: "Full name" },
      { value: "email", label: "Email" },
    ];
    if (cat === "members") {
      base.push(
        { value: "phone", label: "Phone" },
        { value: "address", label: "Mailing address" },
        { value: "membershipClass", label: "Membership class" },
      );
    } else if (cat === "directors") {
      base.push({ value: "position", label: "Position" });
    } else if (cat === "volunteers") {
      base.push({ value: "phone", label: "Phone" });
    } else if (cat === "employees") {
      base.push({ value: "role", label: "Role" });
    }
    return base;
  };

  return (
    <div className="person-ref-picker">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select
          className="input"
          value={category ?? ""}
          onChange={(e) =>
            onChange({
              category: (e.target.value || undefined) as PersonCategory | undefined,
              personId: undefined,
              source: undefined,
            })
          }
        >
          <option value="">— Pick category —</option>
          {PERSON_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={personId ?? ""}
          disabled={!category}
          onChange={(e) =>
            onChange({ personId: e.target.value || undefined, source: undefined })
          }
        >
          <option value="">— Pick person —</option>
          {peopleRaw.map((p: any) => (
            <option key={p._id} value={p._id}>
              {displayName(p)}
              {p.email ? ` · ${p.email}` : ""}
            </option>
          ))}
        </select>
      </div>
      <select
        className="input"
        value={source ?? ""}
        disabled={!category || !personId}
        onChange={(e) => onChange({ source: e.target.value || undefined })}
      >
        <option value="">— Pick field —</option>
        <optgroup label="Built-in">
          {fieldOptionsFor(category).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </optgroup>
        {definitions && definitions.length > 0 && (
          <optgroup label="Custom">
            {definitions.map((d: any) => (
              <option key={d._id} value={`custom:${d.key}`}>
                {d.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {category && !peopleRaw.length && (
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          No {category} yet. Add some in <span className="mono">/app/{category}</span>.
        </div>
      )}
    </div>
  );
}

function FieldMappingEditor({
  fields,
  mappings,
  onFieldsChange,
  onMappingsChange,
}: {
  fields: string[];
  mappings: Record<string, FieldMapping>;
  onFieldsChange: (fields: string[]) => void | Promise<void>;
  onMappingsChange: (next: Record<string, FieldMapping>) => void | Promise<void>;
}) {
  const [newField, setNewField] = useState("");

  const updateMapping = (field: string, patch: Partial<FieldMapping>) => {
    const next = { ...mappings, [field]: { ...(mappings[field] ?? { kind: "empty" }), ...patch } };
    onMappingsChange(next);
  };

  const removeField = (field: string) => {
    const nextFields = fields.filter((f) => f !== field);
    onFieldsChange(nextFields);
    if (mappings[field]) {
      const { [field]: _drop, ...rest } = mappings;
      onMappingsChange(rest);
    }
  };

  const addField = () => {
    const name = newField.trim();
    if (!name || fields.includes(name)) return;
    onFieldsChange([...fields, name]);
    setNewField("");
  };

  return (
    <div className="field-mapping">
      <div className="field-mapping__head">
        <div className="field__label">PDF field mapping</div>
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          Each field can be filled from a literal value, a dynamic token, a person record, or the
          requesting manager. Auto-detection of fields from the template ships with Phase 2.
        </div>
      </div>

      {fields.length === 0 && (
        <div className="muted" style={{ fontSize: "var(--fs-sm)", padding: "8px 0" }}>
          No fields yet. Add one below.
        </div>
      )}

      <div className="field-mapping__rows">
        {fields.map((field) => {
          const mapping: FieldMapping = mappings[field] ?? { kind: "empty" };
          return (
            <div key={field} className="field-mapping__row">
              <div className="field-mapping__name mono">{field}</div>
              <select
                className="input field-mapping__kind"
                value={mapping.kind}
                onChange={(e) =>
                  updateMapping(field, {
                    kind: e.target.value as MappingKind,
                    value: undefined,
                    source: undefined,
                  })
                }
              >
                <option value="empty">— Empty —</option>
                <option value="literal">Literal / default</option>
                <option value="dynamic">Dynamic token</option>
                <option value="person">Person field</option>
                <option value="manager">Manager field</option>
              </select>
              <div className="field-mapping__value">
                {mapping.kind === "literal" && (
                  <input
                    className="input"
                    value={mapping.value ?? ""}
                    placeholder="Default value"
                    onChange={(e) => updateMapping(field, { value: e.target.value })}
                  />
                )}
                {mapping.kind === "dynamic" && (
                  <select
                    className="input"
                    value={mapping.source ?? ""}
                    onChange={(e) => updateMapping(field, { source: e.target.value })}
                  >
                    <option value="">— Pick token —</option>
                    {DYNAMIC_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {mapping.kind === "person" && (
                  <select
                    className="input"
                    value={mapping.source ?? ""}
                    onChange={(e) => updateMapping(field, { source: e.target.value })}
                  >
                    <option value="">— Pick person field —</option>
                    {PERSON_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {mapping.kind === "manager" && (
                  <select
                    className="input"
                    value={mapping.source ?? ""}
                    onChange={(e) => updateMapping(field, { source: e.target.value })}
                  >
                    <option value="">— Pick manager field —</option>
                    {MANAGER_SOURCES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                {mapping.kind === "empty" && (
                  <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    No value at runtime.
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Remove field ${field}`}
                onClick={() => removeField(field)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="field-mapping__add">
        <input
          className="input"
          placeholder="Add PDF field name (e.g. Legal First Name of Affiliate)"
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addField();
            }
          }}
        />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={addField}
          disabled={!newField.trim()}
        >
          <Plus size={12} /> Add field
        </button>
      </div>
    </div>
  );
}
