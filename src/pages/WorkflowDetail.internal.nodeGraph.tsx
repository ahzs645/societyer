// WorkflowDetail: ReactFlow node graph rendering (node types, graph builder, node chrome).
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
import { MarkdownEditor } from "../components/MarkdownEditor";
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

export const nodeTypes = {
  societyerWorkflowNode: WorkflowNode,
};

export function buildGraph(preview: any[]): { nodes: Node[]; edges: Edge[] } {
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

export function WorkflowNode({ data }: NodeProps) {
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

export function NodeIcon({ type }: { type: string }) {
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

export function nodeTypeLabel(type: string) {
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
