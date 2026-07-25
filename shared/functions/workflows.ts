/**
 * PORTABLE FUNCTIONS: the workflow read surface plus the light-touch record
 * mutations (list / listRuns / runsForWorkflow / getRun / listNodeTypes /
 * setStatus / update / addNode).
 *
 * These touch only `ctx.db` (plus the `requireRolePortable` access gate and the
 * pure status parser from shared/workflows/schemas), so they run unchanged on
 * hosted Convex, the local Dexie runtime, and the convex-test oracle.
 *
 * The recipe-aware handlers (listCatalog / get / create / configure /
 * setupGovernanceN8nRecipes) stay on Convex: they lean on the
 * workflow catalog helpers, which read the server env (e.g. to compute live node
 * setup status), and the runner surface (run / inspectPdfTemplate / the external
 * dispatch internals) executes/parses externally. `NODE_TYPE_CATALOG` is a pure
 * constant moved here for `addNode`'s node-type validation.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";
import { parseWorkflowStatus } from "../workflows/schemas";

// The node types a user can append to a workflow's preview graph. Kept in sync
// with the same catalog in convex/workflowCatalog.ts; only the `type` values
// are load-bearing here (used to validate `addNode`).
export const NODE_TYPE_CATALOG: Array<{ type: string; label: string; description: string }> = [
  { type: "manual_trigger", label: "Manual trigger", description: "A person starts the workflow from Societyer." },
  { type: "form", label: "Form", description: "Collects structured input before handing off." },
  { type: "pdf_fill", label: "Fill PDF", description: "Hands a template + payload to the PDF fill endpoint." },
  { type: "document_create", label: "Save document", description: "Stores the generated file in Documents." },
  { type: "email", label: "Send notification", description: "Sends an email / in-app notification." },
  { type: "ai_agent", label: "AI agent", description: "Runs a permissioned Societyer AI agent with workflow variables." },
  { type: "external_n8n", label: "External n8n step", description: "Delegates work to an n8n workflow node." },
];

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("workflows")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .collect();
}

export async function listRunsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  return ctx.db
    .query("workflowRuns")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 50);
}

export async function runsForWorkflowPortable(ctx: PortableQueryCtx, { workflowId }: { workflowId: string }) {
  return ctx.db
    .query("workflowRuns")
    .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
    .order("desc")
    .collect();
}

export async function getRunPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function listNodeTypesPortable() {
  return NODE_TYPE_CATALOG;
}

export async function setStatusPortable(
  ctx: PortableMutationCtx,
  { id, status, actingUserId }: { id: string; status: string; actingUserId?: string },
) {
  const wf = await ctx.db.get(id);
  if (!wf) throw new Error("Workflow not found");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(wf.societyId),
    required: "Director",
  });
  await ctx.db.patch(id, { status: parseWorkflowStatus(status) });
}

// Light-touch patch for inline edits from the record table. Only
// exposes the fields that are safe to tweak without re-computing the
// trigger / provider config: the human-facing `name` and the SELECT
// status. For status parity with the dedicated `setStatus` mutation,
// this also enforces Director role.
export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch, actingUserId }: { id: string; patch: { name?: string; status?: string }; actingUserId?: string },
) {
  const wf = await ctx.db.get(id);
  if (!wf) throw new Error("Workflow not found");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(wf.societyId),
    required: "Director",
  });
  await ctx.db.patch(id, {
    ...patch,
    ...(patch.status ? { status: parseWorkflowStatus(patch.status) } : {}),
  });
}

// Append (or insert) a node into the workflow's preview graph. For now this
// is additive only — no runner logic is attached to user-added nodes; they
// show up in the canvas, the sidepanel, and the run timeline as "pending"
// and are marked skipped if the workflow runs. Clarifying the execution
// contract is tracked for the full bridge MVP.
export async function addNodePortable(
  ctx: PortableMutationCtx,
  {
    id,
    node,
    afterKey,
    actingUserId,
  }: {
    id: string;
    node: { type: string; label: string; description?: string };
    afterKey?: string;
    actingUserId?: string;
  },
) {
  const wf = await ctx.db.get(id);
  if (!wf) throw new Error("Workflow not found");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(wf.societyId),
    required: "Director",
  });

  const valid = NODE_TYPE_CATALOG.some((entry) => entry.type === node.type);
  if (!valid) throw new Error(`Unknown node type: ${node.type}`);

  const existing: Record<string, any>[] = Array.isArray(wf.nodePreview) ? [...wf.nodePreview] : [];
  const baseKey = node.type.replace(/[^a-z0-9_]/gi, "_").toLowerCase() || "node";
  const usedKeys = new Set(existing.map((n) => n.key));
  let newKey = baseKey;
  let suffix = 1;
  while (usedKeys.has(newKey)) {
    newKey = `${baseKey}_${suffix++}`;
  }

  const newNode: Record<string, any> = {
    key: newKey,
    type: node.type,
    label: node.label,
    description: node.description,
    status: "draft",
  };

  let next: Record<string, any>[];
  if (afterKey) {
    const idx = existing.findIndex((n) => n.key === afterKey);
    if (idx === -1) {
      next = [...existing, newNode];
    } else {
      next = [...existing.slice(0, idx + 1), newNode, ...existing.slice(idx + 1)];
    }
  } else {
    next = [...existing, newNode];
  }

  await ctx.db.patch(id, { nodePreview: next });
  return { key: newKey };
}

export async function removePortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const wf = await ctx.db.get(id);
  if (!wf) return;
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(wf.societyId),
    required: "Director",
  });
  await ctx.db.delete(id);
}

export async function updateNodeConfigPortable(
  ctx: PortableMutationCtx,
  {
    id,
    key,
    config,
    label,
    description,
    actingUserId,
  }: {
    id: string;
    key: string;
    config: Record<string, any>;
    label?: string;
    description?: string;
    actingUserId?: string;
  },
) {
  const wf = await ctx.db.get(id);
  if (!wf) throw new Error("Workflow not found");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(wf.societyId),
    required: "Director",
  });
  const existing: Record<string, any>[] = Array.isArray(wf.nodePreview) ? wf.nodePreview : [];
  const idx = existing.findIndex((n) => n.key === key);
  if (idx === -1) throw new Error(`Node ${key} not found on workflow ${id}`);
  const prev = existing[idx];
  const next = [...existing];
  next[idx] = {
    ...prev,
    config: { ...(prev.config ?? {}), ...(config ?? {}) },
    label: label ?? prev.label,
    description: description ?? prev.description,
  };
  await ctx.db.patch(id, { nodePreview: next });
}

export async function removeNodePortable(
  ctx: PortableMutationCtx,
  { id, key, actingUserId }: { id: string; key: string; actingUserId?: string },
) {
  const wf = await ctx.db.get(id);
  if (!wf) throw new Error("Workflow not found");
  await requireRolePortable(ctx, {
    actingUserId,
    societyId: String(wf.societyId),
    required: "Director",
  });
  const existing: Record<string, any>[] = Array.isArray(wf.nodePreview) ? wf.nodePreview : [];
  const next = existing.filter((n) => n.key !== key);
  if (next.length === existing.length) return;
  await ctx.db.patch(id, { nodePreview: next });
}
