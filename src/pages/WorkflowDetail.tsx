import { useMemo, useState } from "react";
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
  const setStatus = useMutation(api.workflows.setStatus);
  const run = useAction(api.workflows.run);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [intake, setIntake] = useState<Record<string, any>>({});

  const recipe = catalog?.find((item: any) => item.key === workflow?.recipe);
  const preview = (workflow?.nodePreview?.length ? workflow.nodePreview : recipe?.nodePreview ?? []) as any[];
  const selectedNode = preview.find((node) => node.key === selectedKey) ?? preview[0];
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
          <button className="btn btn--ghost btn--sm" disabled title="Native editing lands after the bridge MVP.">
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
              </div>
              {selectedNode.key === "fill_pdf" && (
                <div className="workflow-sidepanel__section">
                  <div className="field__label">PDF setup</div>
                  <p className="muted">
                    n8n calls Societyer&apos;s PDF fill endpoint. The server reads the template from
                    <span className="mono"> UNBC_AFFILIATE_TEMPLATE_PATH</span>.
                  </p>
                </div>
              )}
              {workflow.provider === "n8n" && (
                <div className="workflow-sidepanel__section">
                  <div className="field__label">n8n webhook</div>
                  <div className="workflow-codebox">{providerConfig.externalWebhookUrl ?? "Not configured"}</div>
                </div>
              )}
              {isUnbc && (
                <div className="workflow-sidepanel__section">
                  <div className="field__label">UNBC PDF fields</div>
                  <div className="workflow-field-list">
                    {FIELD_LABELS.map((field) => (
                      <span key={field}>{field}</span>
                    ))}
                  </div>
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
