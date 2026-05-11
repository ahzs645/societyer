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
import { Select } from "../components/Select";

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

type IntakeFieldType = "text" | "email" | "phone" | "date" | "checkbox" | "textarea" | "person";

type IntakeField = {
  key: string;
  label: string;
  type: IntakeFieldType;
  required?: boolean;
  defaultValue?: unknown;
  helpText?: string;
  categories?: string[];
  isHidden?: boolean;
};

type TemplateToken = {
  label: string;
  value: string;
  group: string;
};

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
  const sampleInput = workflow.config?.sampleInput ?? workflow.config?.sampleAffiliate ?? {};
  const intakeFields = configuredIntakeFields(workflow);
  const visibleIntakeFields = intakeFields.filter((field) => !field.isHidden);
  const launchUsesIntake = visibleIntakeFields.length > 0;

  const openIntake = () => {
    setIntake(initialIntakeValues(intakeFields, sampleInput));
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
            onClick={() => (launchUsesIntake ? openIntake() : runWorkflow())}
          >
            <Play size={12} /> Launch
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
                onLaunch={() => (launchUsesIntake ? openIntake() : runWorkflow())}
                launchDisabled={busy}
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

      <Modal
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        title={`Launch ${workflow.name}`}
        size="lg"
        footer={
          <>
            <button className="btn" disabled={busy} onClick={() => setIntakeOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn--accent"
              disabled={busy}
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
                  <textarea
                    className="textarea"
                    rows={3}
                    value={intake[field.key] ?? ""}
                    onChange={(event) => setIntake({ ...intake, [field.key]: event.target.value })}
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
    case "ai_agent":
      return <Bot {...props} />;
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
    case "ai_agent":
      return "AI agent";
    default:
      return "Action";
  }
}

function checkboxLabel(field: string) {
  if (field === "Check Box0") return "Previous UNBC ID - yes";
  if (field === "Check Box1") return "Previous UNBC ID - no";
  return field;
}

function slugifyFieldKey(label: string) {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || "field";
}

function inferIntakeFieldType(label: string): IntakeFieldType {
  const norm = label.toLowerCase();
  if (/check\s*box|yes\/no|true\/false/.test(norm)) return "checkbox";
  if (/e-?mail/.test(norm)) return "email";
  if (/phone|tel|mobile|cell/.test(norm)) return "phone";
  if (/date|birth/.test(norm)) return "date";
  if (/address|note|description|comment/.test(norm)) return "textarea";
  return "text";
}

function normalizeIntakeFields(raw: any, fallback?: any): IntakeField[] {
  const source = Array.isArray(raw) && raw.length > 0
    ? raw
    : Array.isArray(fallback) && fallback.length > 0
      ? fallback
      : [];
  const seen = new Set<string>();
  return source
    .map((entry: any): IntakeField | null => {
      if (typeof entry === "string") {
        const label = entry.trim();
        if (!label) return null;
        const key = uniqueFieldKey(slugifyFieldKey(label), seen);
        return {
          key,
          label,
          type: inferIntakeFieldType(label),
          required: false,
        };
      }
      if (!entry || typeof entry !== "object") return null;
      const label = String(entry.label ?? entry.name ?? entry.key ?? "").trim();
      if (!label) return null;
      const rawKey = String(entry.key ?? entry.name ?? slugifyFieldKey(label)).trim();
      const key = uniqueFieldKey(slugifyFieldKey(rawKey), seen);
      const type = ["text", "email", "phone", "date", "checkbox", "textarea", "person"].includes(entry.type)
        ? entry.type as IntakeFieldType
        : inferIntakeFieldType(label);
      return {
        key,
        label,
        type,
        required: Boolean(entry.required),
        defaultValue: entry.defaultValue,
        helpText: typeof entry.helpText === "string" ? entry.helpText : undefined,
        categories: Array.isArray(entry.categories) ? entry.categories.map(String) : undefined,
        isHidden: Boolean(entry.isHidden),
      };
    })
    .filter(Boolean) as IntakeField[];
}

function uniqueFieldKey(base: string, seen: Set<string>) {
  let key = base || "field";
  let suffix = 2;
  while (seen.has(key)) key = `${base}_${suffix++}`;
  seen.add(key);
  return key;
}

function configuredIntakeFields(workflow: any) {
  const intakeNode = Array.isArray(workflow?.nodePreview)
    ? workflow.nodePreview.find((node: any) => node?.type === "form")
    : null;
  const fallback =
    workflow?.config?.intakeFields ??
    workflow?.config?.pdfFields ??
    (workflow?.config?.sampleInput && typeof workflow.config.sampleInput === "object"
      ? Object.keys(workflow.config.sampleInput)
      : workflow?.config?.sampleAffiliate && typeof workflow.config.sampleAffiliate === "object"
        ? Object.keys(workflow.config.sampleAffiliate)
      : FIELD_LABELS);
  return normalizeIntakeFields(intakeNode?.config?.fields, fallback);
}

function initialIntakeValues(fields: IntakeField[], sample: Record<string, any>) {
  const values: Record<string, any> = {};
  for (const field of fields) {
    const fallback = sample[field.key] ?? sample[field.label] ?? field.defaultValue;
    values[field.key] = field.type === "checkbox" ? Boolean(fallback) : fallback ?? "";
  }
  return values;
}

function intakePayloadFromState(fields: IntakeField[], values: Record<string, any>) {
  const payload: Record<string, any> = {};
  for (const field of fields) {
    const value = field.type === "checkbox" ? Boolean(values[field.key]) : values[field.key] ?? "";
    payload[field.key] = value;
    // Preserve AcroForm label lookups and older mappings that used the label as the key.
    payload[field.label] = value;
  }
  return payload;
}

function missingRequiredIntakeFields(fields: IntakeField[], values: Record<string, any>) {
  return fields
    .filter((field) => {
      if (!field.required) return false;
      const value = values[field.key];
      if (field.type === "person") {
        return !value || typeof value !== "object" || (!value.recordId && !value.name);
      }
      if (field.type === "checkbox") return !Boolean(value);
      return value == null || String(value).trim() === "";
    })
    .map((field) => field.label);
}

function AccessPersonPicker({
  societyId,
  field,
  value,
  onChange,
}: {
  societyId: string;
  field: IntakeField;
  value: any;
  onChange: (value: any) => void;
}) {
  const categoryOptions = (field.categories?.length
    ? field.categories
    : ["directors", "volunteers", "employees"]
  ).filter((category) => ["directors", "volunteers", "employees"].includes(category));
  const selectedCategory = typeof value?.category === "string" ? value.category : categoryOptions[0];
  const societyArg = { societyId: societyId as any };
  const directors = useQuery(api.directors.list, selectedCategory === "directors" ? societyArg : "skip");
  const volunteers = useQuery(api.volunteers.list, selectedCategory === "volunteers" ? societyArg : "skip");
  const employees = useQuery(api.employees.list, selectedCategory === "employees" ? societyArg : "skip");
  const people =
    selectedCategory === "directors"
      ? directors ?? []
      : selectedCategory === "volunteers"
        ? volunteers ?? []
        : selectedCategory === "employees"
          ? employees ?? []
          : [];

  const labelForCategory = (category: string) =>
    category === "directors" ? "Directors" : category === "volunteers" ? "Volunteers" : "Employees";
  const displayName = (person: any) => {
    const full = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
    return full || person.name || person.email || "Unnamed";
  };
  const roleForPerson = (person: any) => {
    if (selectedCategory === "directors") return person.position || "Director";
    if (selectedCategory === "volunteers") return person.roleWanted || person.status || "Volunteer";
    if (selectedCategory === "employees") return person.role || person.employmentType || "Employee";
    return "";
  };
  const selectedId = typeof value?.recordId === "string" ? value.recordId : "";

  const updateCategory = (category: string) => {
    onChange({
      category,
      recordId: "",
      name: "",
      email: "",
      role: "",
    });
  };

  const updatePerson = (recordId: string) => {
    const person = people.find((row: any) => String(row._id) === recordId);
    if (!person) {
      onChange({
        category: selectedCategory,
        recordId: "",
        name: "",
        email: "",
        role: "",
      });
      return;
    }
    onChange({
      category: selectedCategory,
      recordId,
      name: displayName(person),
      email: person.email ?? "",
      role: roleForPerson(person),
    });
  };

  return (
    <div className="person-ref-picker">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Select value={selectedCategory} onChange={value => updateCategory(value)} options={[...categoryOptions.map(category => ({
  value: category,
  label: labelForCategory(category)
}))]} className="input" />
        <Select value={selectedId} onChange={value => updatePerson(value)} options={[{
  value: "",
  label: "Pick individual"
}, ...people.map((person: any) => ({
  value: person._id,
  label: [displayName(person), person.email ? ` · ${person.email}` : ""].join(" ")
}))]} className="input" />
      </div>
      {selectedCategory && people.length === 0 && (
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          No {labelForCategory(selectedCategory).toLowerCase()} are available yet.
        </div>
      )}
    </div>
  );
}

function documentDefaults(workflow: any) {
  const cfg = workflow?.config ?? {};
  if (cfg.pdfTemplateKey !== "unbc_affiliate_id") return {};
  return {
    category: cfg.documentCategory ?? "WorkflowGenerated",
    tags: Array.isArray(cfg.documentTags) ? cfg.documentTags : ["workflow-generated", "unbc-affiliate-id"],
    retentionYears: typeof cfg.documentRetentionYears === "number" ? cfg.documentRetentionYears : 10,
    titleTemplate:
      cfg.documentTitleTemplate ??
      "UNBC Affiliate ID Request - {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}",
    changeNote: cfg.documentChangeNote ?? "Generated by UNBC Affiliate ID Request workflow.",
  };
}

function emailDefaults(workflow: any) {
  const cfg = workflow?.config ?? {};
  if (cfg.pdfTemplateKey !== "unbc_affiliate_id") return {};
  return {
    to: cfg.emailTo ?? "employmentprocessing@unbc.ca",
    subject:
      cfg.emailSubject ??
      "Completed affiliate status request form - {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}",
    body:
      cfg.emailBody ??
      [
        "Hello,",
        "",
        "Please see the attached completed UNBC affiliate status request form for {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}.",
        "",
        "The generated PDF is attached for processing.",
        "",
        "Thanks,",
        "{{intake.name_of_requesting_manager}}",
      ].join("\n"),
  };
}

function workflowTemplateTokens(workflow: any): TemplateToken[] {
  const intakeTokens = configuredIntakeFields(workflow).map((field) => ({
    group: "Intake",
    label: field.label,
    value: `{{intake.${field.key}}}`,
  }));
  return [
    ...intakeTokens,
    { group: "Document", label: "Generated PDF title", value: "{{document.title}}" },
    { group: "Document", label: "Generated PDF file name", value: "{{document.fileName}}" },
    { group: "Document", label: "Document category", value: "{{document.category}}" },
    { group: "Workflow", label: "Workflow name", value: "{{workflow.name}}" },
    { group: "Workflow", label: "Run ID", value: "{{run.id}}" },
    { group: "User", label: "Launcher name", value: "{{currentUser.name}}" },
    { group: "User", label: "Launcher email", value: "{{currentUser.email}}" },
    { group: "Dynamic", label: "Today", value: "{{today}}" },
  ];
}

type NodeSetupPanelProps = {
  node: any;
  workflow: any;
  documents: any[];
  onLaunch: () => void;
  launchDisabled?: boolean;
  onSave: (patch: Record<string, any>) => Promise<void>;
};

function NodeSetupPanel({ node, workflow, documents, onLaunch, launchDisabled, onSave }: NodeSetupPanelProps) {
  const cfg = node.config ?? {};
  const recipeCfg = workflow?.config ?? {};
  const emailCfg = { ...emailDefaults(workflow), ...cfg };

  const blurbs: Record<string, string> = {
    manual_trigger: "A person starts this workflow from inside Societyer. No external setup required.",
    form: "Collects structured input before handing off to later steps. Define the fields to collect.",
    pdf_fill: "Picks up a fillable PDF from Documents, fills mapped AcroForm fields, and saves the output as a new document version.",
    document_create: "Saves the output of a prior step into Documents with a category and retention policy.",
    email: "Queues a manual-send Outbox draft with templated content and the generated document attached.",
    ai_agent: "Runs a permissioned Societyer AI agent. The prompt can include workflow and intake variables.",
    external_n8n: "Hands execution to an n8n workflow via its webhook URL. n8n then calls back to progress the timeline.",
  };
  const launchLabel =
    typeof cfg.launchLabel === "string" && cfg.launchLabel.trim()
      ? cfg.launchLabel.trim()
      : "Launch workflow";

  return (
    <div className="workflow-sidepanel__section workflow-setup">
      <div className="field__label">Setup</div>
      <p className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 8 }}>
        {blurbs[node.type] ?? "No setup options for this node type."}
      </p>

      {node.type === "manual_trigger" && (
        <>
          <button
            type="button"
            className="btn btn--accent btn--sm"
            disabled={launchDisabled}
            onClick={onLaunch}
          >
            <Play size={12} /> {launchLabel}
          </button>
          <LabeledInput
            label="Trigger label"
            value={cfg.launchLabel ?? ""}
            placeholder="Launch workflow"
            onSave={(v) => onSave({ launchLabel: v })}
          />
        </>
      )}

      {node.type === "form" && (
        <IntakeFieldSetup
          fields={normalizeIntakeFields(
            cfg.fields,
            recipeCfg.intakeFields ??
              recipeCfg.pdfFields ??
              (recipeCfg.sampleAffiliate && typeof recipeCfg.sampleAffiliate === "object"
                ? Object.keys(recipeCfg.sampleAffiliate)
                : FIELD_LABELS),
          )}
          onSave={(fields) => onSave({ fields })}
        />
      )}

      {node.type === "pdf_fill" && (
        <PdfFillSetup
          node={node}
          cfg={cfg}
          intakeFields={configuredIntakeFields(workflow)}
          documents={documents}
          recipeFields={Array.isArray(recipeCfg.pdfFields) ? recipeCfg.pdfFields : []}
          onSave={onSave}
        />
      )}

      {node.type === "document_create" && (
        <DocumentCreateSetup
          cfg={cfg}
          defaults={documentDefaults(workflow)}
          onSave={onSave}
        />
      )}

      {node.type === "email" && (
        <>
          <LabeledInput
            label="To"
            value={emailCfg.to ?? ""}
            placeholder="recipient@example.com"
            onSave={(v) => onSave({ to: v })}
          />
          <LabeledInput
            label="Subject"
            value={emailCfg.subject ?? ""}
            placeholder="Completed affiliate status request form"
            onSave={(v) => onSave({ subject: v })}
          />
          <TemplateTextarea
            label="Body"
            value={emailCfg.body ?? ""}
            placeholder={"Hello,\n\nHere is the completed affiliate status request form.\n\nThanks,"}
            tokens={workflowTemplateTokens(workflow)}
            onSave={(v) => onSave({ body: v })}
          />
        </>
      )}

      {node.type === "ai_agent" && (
        <>
          <LabeledInput
            label="Agent key"
            value={cfg.agentKey ?? "compliance_analyst"}
            placeholder="compliance_analyst"
            onSave={(v) => onSave({ agentKey: v })}
          />
          <TemplateTextarea
            label="Prompt template"
            value={cfg.promptTemplate ?? "Review {{workflow.name}} with this workflow input: {{input}}"}
            placeholder="Review {{workflow.name}} with this workflow input: {{input}}"
            tokens={workflowTemplateTokens(workflow)}
            onSave={(v) => onSave({ promptTemplate: v })}
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

      {node.type !== "manual_trigger" && (
        <div className="workflow-setup__footer">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled
            title={node.type === "ai_agent" ? "AI agent steps run as part of the workflow." : "Test harness ships with Phase 2 — executing nodes individually."}
          >
            <Play size={12} /> Test node
          </button>
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            {node.type === "ai_agent"
              ? "AI agent output is stored on the workflow run step."
              : "Runner support for user-edited nodes is staged; config saved here will wire in once execution lands."}
          </span>
        </div>
      )}
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

function TemplateTextarea({
  label,
  value,
  placeholder,
  tokens,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  tokens: TemplateToken[];
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [slash, setSlash] = useState<{ start: number; term: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastExternal = useRef(value);
  if (lastExternal.current !== value) {
    lastExternal.current = value;
    if (draft !== value) setDraft(value);
  }

  const filteredTokens = slash
    ? tokens
        .filter((token) => `${token.group} ${token.label} ${token.value}`.toLowerCase().includes(slash.term))
        .slice(0, 8)
    : [];

  const detectSlash = (text: string, cursor: number) => {
    const start = text.lastIndexOf("/", cursor - 1);
    if (start < 0) return null;
    const before = start === 0 ? "" : text[start - 1];
    const term = text.slice(start + 1, cursor);
    if (before && !/\s/.test(before)) return null;
    if (/\s/.test(term)) return null;
    return { start, term: term.toLowerCase() };
  };

  const updateDraft = (next: string, cursor: number) => {
    setDraft(next);
    setSlash(detectSlash(next, cursor));
  };

  const insertToken = (token: TemplateToken) => {
    const textarea = textareaRef.current;
    if (!textarea || !slash) return;
    const cursor = textarea.selectionStart ?? draft.length;
    const next = `${draft.slice(0, slash.start)}${token.value}${draft.slice(cursor)}`;
    setDraft(next);
    setSlash(null);
    requestAnimationFrame(() => {
      const nextCursor = slash.start + token.value.length;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <Field label={label}>
      <div className="template-textarea">
        <textarea
          ref={textareaRef}
          className="textarea"
          value={draft}
          placeholder={placeholder}
          rows={7}
          onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
          onKeyUp={(event) => {
            const target = event.currentTarget;
            setSlash(detectSlash(target.value, target.selectionStart));
          }}
          onBlur={() => {
            window.setTimeout(() => setSlash(null), 120);
            if (draft !== value) onSave(draft);
          }}
        />
        {slash && filteredTokens.length > 0 && (
          <div className="template-token-menu">
            {filteredTokens.map((token) => (
              <button
                key={`${token.group}-${token.value}`}
                type="button"
                className="template-token-menu__item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertToken(token);
                }}
              >
                <span className="template-token-menu__group">{token.group}</span>
                <span className="template-token-menu__label">{token.label}</span>
                <span className="template-token-menu__value mono">{token.value}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
        Type / to insert workflow, intake, document, or date fields.
      </div>
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

function DocumentCreateSetup({
  cfg,
  defaults,
  onSave,
}: {
  cfg: Record<string, any>;
  defaults: Record<string, any>;
  onSave: (patch: Record<string, any>) => Promise<void>;
}) {
  const category = cfg.category ?? defaults.category ?? "";
  const tags = Array.isArray(cfg.tags) ? cfg.tags : Array.isArray(defaults.tags) ? defaults.tags : [];
  const retentionYears = cfg.retentionYears ?? defaults.retentionYears ?? 10;
  const titleTemplate = cfg.titleTemplate ?? defaults.titleTemplate ?? "";
  const changeNote = cfg.changeNote ?? defaults.changeNote ?? "";

  return (
    <>
      <LabeledInput
        label="Category"
        value={category}
        placeholder="WorkflowGenerated"
        onSave={(v) => onSave({ category: v })}
      />
      <LabeledInput
        label="Generated document title"
        value={titleTemplate}
        placeholder="UNBC Affiliate ID Request - {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}"
        onSave={(v) => onSave({ titleTemplate: v })}
      />
      <LabeledInput
        label="Retention years"
        value={String(retentionYears)}
        placeholder="10"
        onSave={(v) => {
          const parsed = Number(v);
          return onSave({ retentionYears: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined });
        }}
      />
      <LabeledInput
        label="Tags (comma-separated)"
        value={tags.join(", ")}
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
      <LabeledTextarea
        label="Version note"
        value={changeNote}
        placeholder="Generated by workflow."
        onSave={(v) => onSave({ changeNote: v })}
      />
    </>
  );
}

function IntakeFieldSetup({
  fields,
  onSave,
}: {
  fields: IntakeField[];
  onSave: (next: IntakeField[]) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const requiredCount = fields.filter((field) => field.required).length;
  const byType = fields.reduce<Record<string, number>>((acc, field) => {
    acc[field.type] = (acc[field.type] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(byType)
    .map(([type, count]) => `${count} ${type}`)
    .join(" · ");

  return (
    <>
      <Field label="Intake fields">
        <div className="pdf-picker-trigger">
          <div className="pdf-picker-trigger__label">
            <strong>{fields.length} fields configured</strong>
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              {fields.length === 0
                ? "Open the wizard to define what the launch form collects."
                : `${requiredCount} required${breakdown ? ` · ${breakdown}` : ""}`}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setOpen(true)}
          >
            {fields.length === 0 ? "Start wizard" : "Edit fields"}
          </button>
        </div>
      </Field>
      <IntakeFieldWizardModal
        open={open}
        onClose={() => setOpen(false)}
        fields={fields}
        onSave={async (next) => {
          await onSave(next);
          setOpen(false);
        }}
      />
    </>
  );
}

function IntakeFieldWizardModal({
  open,
  onClose,
  fields,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  fields: IntakeField[];
  onSave: (next: IntakeField[]) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<IntakeField[]>(fields);
  const [stepIndex, setStepIndex] = useState(0);
  const [newField, setNewField] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(fields);
    setStepIndex(0);
    setNewField("");
  }, [open, fields]);

  const safeIndex = Math.min(stepIndex, Math.max(0, draft.length - 1));
  const current = draft[safeIndex];
  const usedKeys = (exceptIndex?: number) =>
    new Set(draft.map((field, idx) => (idx === exceptIndex ? "" : field.key)).filter(Boolean));

  const updateCurrent = (patch: Partial<IntakeField>) => {
    if (!current) return;
    setDraft((prev) =>
      prev.map((field, idx) => {
        if (idx !== safeIndex) return field;
        const next = { ...field, ...patch };
        if (patch.key !== undefined) {
          next.key = uniqueFieldKey(slugifyFieldKey(patch.key), usedKeys(idx));
        }
        return next;
      }),
    );
  };

  const addField = () => {
    const label = newField.trim();
    if (!label) return;
    const nextField: IntakeField = {
      key: uniqueFieldKey(slugifyFieldKey(label), usedKeys()),
      label,
      type: inferIntakeFieldType(label),
      required: false,
    };
    setDraft((prev) => [...prev, nextField]);
    setNewField("");
    setStepIndex(draft.length);
  };

  const removeCurrent = () => {
    if (!current) return;
    setDraft((prev) => prev.filter((_, idx) => idx !== safeIndex));
    setStepIndex((idx) => Math.max(0, idx - 1));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Configure intake fields"
      footer={
        <>
          <div className="muted" style={{ marginRight: "auto", fontSize: "var(--fs-sm)" }}>
            {draft.length} fields · {draft.filter((field) => field.required).length} required
          </div>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--accent" onClick={() => onSave(draft)}>
            Save fields
          </button>
        </>
      }
    >
      <div className="mapping-wizard">
        <aside className="mapping-wizard__sidebar">
          <div className="field__label">Fields</div>
          <div className="mapping-wizard__list">
            {draft.length === 0 && (
              <div className="muted" style={{ padding: 8, fontSize: "var(--fs-sm)" }}>
                Add a field below.
              </div>
            )}
            {draft.map((field, idx) => (
              <button
                key={`${field.key}-${idx}`}
                type="button"
                className={`mapping-wizard__item${idx === safeIndex ? " is-active" : ""}`}
                onClick={() => setStepIndex(idx)}
              >
                <span className="mapping-wizard__item-label">{field.label}</span>
                <span className="mapping-wizard__item-badge is-done">{field.type}</span>
              </button>
            ))}
          </div>
          <div className="mapping-wizard__add">
            <input
              className="input"
              placeholder="Add field label"
              value={newField}
              onChange={(event) => setNewField(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
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
          {!current ? (
            <div className="muted" style={{ padding: 16 }}>
              Add an intake field to configure launch form inputs.
            </div>
          ) : (
            <>
              <div className="mapping-wizard__stepper muted" style={{ fontSize: "var(--fs-xs)" }}>
                Field {safeIndex + 1} of {draft.length}
              </div>
              <h3 className="mapping-wizard__field">{current.label}</h3>

              <div className="intake-field-grid">
                <Field label="Label">
                  <input
                    className="input"
                    value={current.label}
                    onChange={(event) => updateCurrent({ label: event.target.value })}
                  />
                </Field>
                <Field label="Downstream key">
                  <input
                    className="input mono"
                    value={current.key}
                    onChange={(event) => updateCurrent({ key: event.target.value })}
                  />
                </Field>
                <Field label="Type">
                  <Select value={current.type} onChange={value => updateCurrent({
  type: value as IntakeFieldType
})} options={[{
  value: "text",
  label: "Text"
}, {
  value: "textarea",
  label: "Long text"
}, {
  value: "email",
  label: "Email"
}, {
  value: "phone",
  label: "Phone"
}, {
  value: "date",
  label: "Date"
}, {
  value: "checkbox",
  label: "Checkbox"
}, {
  value: "person",
  label: "Person picker"
}]} className="input" />
                </Field>
                <Field label="Default value">
                  {current.type === "checkbox" ? (
                    <label className="workflow-checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(current.defaultValue)}
                        onChange={(event) => updateCurrent({ defaultValue: event.target.checked })}
                      />
                      <span>Checked by default</span>
                    </label>
                  ) : (
                    <input
                      className="input"
                      value={typeof current.defaultValue === "string" ? current.defaultValue : ""}
                      onChange={(event) => updateCurrent({ defaultValue: event.target.value })}
                    />
                  )}
                </Field>
              </div>

              <label className="workflow-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(current.required)}
                  onChange={(event) => updateCurrent({ required: event.target.checked })}
                />
                <span>Required at launch</span>
              </label>

              <Field label="Help text">
                <textarea
                  className="textarea"
                  rows={3}
                  value={current.helpText ?? ""}
                  onChange={(event) => updateCurrent({ helpText: event.target.value })}
                />
              </Field>

              <div className="mapping-wizard__row-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={removeCurrent}
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

function PdfFillSetup({
  node,
  cfg,
  intakeFields,
  documents,
  recipeFields,
  onSave,
}: {
  node: any;
  cfg: Record<string, any>;
  intakeFields: IntakeField[];
  documents: any[];
  recipeFields: string[];
  onSave: (patch: Record<string, any>) => Promise<void>;
}) {
  const pdfs = (documents ?? []).filter(
    (doc: any) => doc.mimeType === "application/pdf" || /\.pdf$/i.test(doc.fileName ?? ""),
  );
  const selectedDoc = pdfs.find((doc: any) => doc._id === cfg.templateDocumentId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mapperOpen, setMapperOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const inspectPdfTemplate = useAction(api.workflows.inspectPdfTemplate);
  const toast = useToast();

  const mappings: Record<string, any> = (cfg.fieldMappings && typeof cfg.fieldMappings === "object")
    ? cfg.fieldMappings
    : {};
  const currentFields: string[] = Array.isArray(cfg.fields) && cfg.fields.length > 0
    ? cfg.fields
    : recipeFields.length > 0
      ? recipeFields
      : Object.keys(mappings);
  const mappingSummary = summariseMappings(currentFields, mappings);
  const inspection = cfg.fieldInspection && typeof cfg.fieldInspection === "object"
    ? cfg.fieldInspection
    : null;

  const autoDetectFields = async () => {
    if (!selectedDoc) return;
    setDetecting(true);
    try {
      const result = await inspectPdfTemplate({ documentId: selectedDoc._id });
      const detected = Array.isArray(result?.fields)
        ? result.fields.map((field: any) => String(field.name)).filter(Boolean)
        : [];
      if (detected.length === 0) {
        toast.error("No fillable PDF fields found");
        return;
      }
      const nextMappings = { ...mappings };
      for (const field of detected) {
        if (nextMappings[field]) continue;
        nextMappings[field] = suggestMappingForField(field, intakeFields) ?? { kind: "empty" };
      }
      await onSave({
        fields: detected,
        fieldMappings: nextMappings,
        fieldInspection: {
          detectedAtISO: result.detectedAtISO,
          fieldCount: result.fieldCount,
          pageCount: result.pageCount,
          tables: result.tables ?? [],
        },
      });
      toast.success(
        "PDF fields detected",
        `${detected.length} fields${result?.tables?.length ? ` · ${result.tables.length} table group(s)` : ""}`,
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Could not inspect the PDF");
    } finally {
      setDetecting(false);
    }
  };

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
        intakeFields={intakeFields}
        onFieldsChange={(fields) => onSave({ fields })}
        onMappingsChange={(next) => onSave({ fieldMappings: next })}
      />

      {inspection && (
        <Field label="Detected structure">
          <div className="workflow-codebox">
            {inspection.fieldCount ?? currentFields.length} fields
            {Array.isArray(inspection.tables) && inspection.tables.length > 0
              ? ` · ${inspection.tables.map((table: any) => `${table.label}: ${table.rowCount} rows`).join(" · ")}`
              : " · no repeated field tables detected"}
          </div>
        </Field>
      )}

      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!selectedDoc || detecting}
          title={selectedDoc ? "Read AcroForm field names from the selected PDF." : "Pick a PDF template first."}
          onClick={autoDetectFields}
        >
          {detecting ? "Detecting..." : "Auto-detect fields"}
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

type MappingKind = "literal" | "dynamic" | "intake" | "person" | "personRef" | "manager" | "empty";

type PersonCategory = "members" | "directors" | "volunteers" | "employees";

type FieldMapping = {
  kind: MappingKind;
  // literal/default text
  value?: string;
  // dynamic: "today" | "today:long" | "now" | "society.name" | ...
  // intake/person/manager/personRef: "firstName" | "lastName" | "email" | "custom:<key>" | ...
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
function suggestMappingForField(fieldName: string, intakeFields: IntakeField[] = []): FieldMapping | null {
  const norm = fieldName.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
  const contains = (needle: string) => norm.includes(needle);
  const match = (re: RegExp) => re.test(norm);
  const intakeMatch = intakeFields.find((field) => {
    const fieldLabel = field.label.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
    const fieldKey = field.key.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
    return fieldLabel === norm || fieldKey === norm;
  });
  if (intakeMatch) return { kind: "intake", source: intakeMatch.key };

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
    intake: 0,
    person: 0,
    personRef: 0,
    manager: 0,
    empty: 0,
  };
  for (const field of fields) {
    const m = mappings[field];
    if (!m || m.kind === "empty") continue;
    if (m.kind === "literal" && !(m.value ?? "").trim()) continue;
    if ((m.kind === "dynamic" || m.kind === "intake" || m.kind === "person" || m.kind === "manager") && !m.source) continue;
    if (m.kind === "personRef" && (!m.category || !m.personId || !m.source)) continue;
    counts[m.kind] += 1;
    mapped += 1;
  }
  const parts: string[] = [];
  if (counts.literal) parts.push(`${counts.literal} literal`);
  if (counts.dynamic) parts.push(`${counts.dynamic} dynamic`);
  if (counts.intake) parts.push(`${counts.intake} intake`);
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
  intake: "Intake",
  person: "Person",
  personRef: "Person record",
  manager: "Manager",
};

function FieldMappingWizardModal({
  open,
  onClose,
  fields,
  mappings,
  intakeFields,
  onFieldsChange,
  onMappingsChange,
}: {
  open: boolean;
  onClose: () => void;
  fields: string[];
  mappings: Record<string, FieldMapping>;
  intakeFields: IntakeField[];
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
    const suggestion = suggestMappingForField(name, intakeFields);
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
                  ((existing.kind === "dynamic" || existing.kind === "intake" || existing.kind === "person" || existing.kind === "manager") && !existing.source);
                if (!isEmpty) continue;
                const suggestion = suggestMappingForField(field, intakeFields);
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
                !((m.kind === "dynamic" || m.kind === "intake" || m.kind === "person" || m.kind === "manager") && !m.source);
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
                const suggestion = suggestMappingForField(currentField, intakeFields);
                if (!suggestion) return null;
                const label =
                  suggestion.kind === "dynamic"
                    ? `Dynamic · ${DYNAMIC_SOURCES.find((s) => s.value === suggestion.source)?.label ?? suggestion.source}`
                    : suggestion.kind === "intake"
                      ? `Intake · ${intakeFields.find((field) => field.key === suggestion.source)?.label ?? suggestion.source}`
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
                {(["literal", "dynamic", "intake", "person", "personRef", "manager", "empty"] as MappingKind[]).map((k) => (
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
                          intake: "Value collected by the intake form",
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
                  <Select value={current.source ?? ""} onChange={value => updateMapping({
  source: value
})} options={[{
  value: "",
  label: "— Pick token —"
}, ...DYNAMIC_SOURCES.map(opt => ({
  value: opt.value,
  label: opt.label
}))]} className="input" />
                )}
                {current.kind === "intake" && (
                  <Select value={current.source ?? ""} onChange={value => updateMapping({
  source: value
})} options={[{
  value: "",
  label: "— Pick intake field —"
}, ...intakeFields.map(field => ({
  value: field.key,
  label: field.label
}))]} className="input" />
                )}
                {current.kind === "person" && (
                  <Select value={current.source ?? ""} onChange={value => updateMapping({
  source: value
})} options={[{
  value: "",
  label: "— Pick person field —"
}, ...PERSON_SOURCES.map(opt => ({
  value: opt.value,
  label: opt.label
}))]} className="input" />
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
                  <Select value={current.source ?? ""} onChange={value => updateMapping({
  source: value
})} options={[{
  value: "",
  label: "— Pick manager field —"
}, ...MANAGER_SOURCES.map(opt => ({
  value: opt.value,
  label: opt.label
}))]} className="input" />
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
        <Select value={category ?? ""} onChange={value => onChange({
  category: (value || undefined) as PersonCategory | undefined,
  personId: undefined,
  source: undefined
})} options={[{
  value: "",
  label: "— Pick category —"
}, ...PERSON_CATEGORIES.map(c => ({
  value: c.value,
  label: c.label
}))]} className="input" />
        <Select value={personId ?? ""} onChange={value => onChange({
  personId: value || undefined,
  source: undefined
})} options={[{
  value: "",
  label: "— Pick person —"
}, ...peopleRaw.map((p: any) => ({
  value: p._id,
  label: [displayName(p), p.email ? ` · ${p.email}` : ""].join(" ")
}))]} className="input" disabled={!category} />
      </div>
      <Select value={source ?? ""} onChange={value => onChange({
  source: value || undefined
})} options={[{
  value: "",
  label: "— Pick field —"
}, ...(definitions ?? []).map((d: any) => ({
  value: `custom:${d.key}`,
  label: d.label
}))]} className="input" disabled={!category || !personId} />
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
              <Select value={mapping.kind} onChange={value => updateMapping(field, {
  kind: value as MappingKind,
  value: undefined,
  source: undefined
})} options={[{
  value: "empty",
  label: "— Empty —"
}, {
  value: "literal",
  label: "Literal / default"
}, {
  value: "dynamic",
  label: "Dynamic token"
}, {
  value: "person",
  label: "Person field"
}, {
  value: "manager",
  label: "Manager field"
}]} className="input field-mapping__kind" />
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
                  <Select value={mapping.source ?? ""} onChange={value => updateMapping(field, {
  source: value
})} options={[{
  value: "",
  label: "— Pick token —"
}, ...DYNAMIC_SOURCES.map(opt => ({
  value: opt.value,
  label: opt.label
}))]} className="input" />
                )}
                {mapping.kind === "person" && (
                  <Select value={mapping.source ?? ""} onChange={value => updateMapping(field, {
  source: value
})} options={[{
  value: "",
  label: "— Pick person field —"
}, ...PERSON_SOURCES.map(opt => ({
  value: opt.value,
  label: opt.label
}))]} className="input" />
                )}
                {mapping.kind === "manager" && (
                  <Select value={mapping.source ?? ""} onChange={value => updateMapping(field, {
  source: value
})} options={[{
  value: "",
  label: "— Pick manager field —"
}, ...MANAGER_SOURCES.map(opt => ({
  value: opt.value,
  label: opt.label
}))]} className="input" />
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
