import { z } from "zod";
import type { Permission } from "../functions/permissions";

export type PipelineScalar = string | number | boolean | null;
export type PipelineInputs = Record<string, PipelineScalar>;
export type PipelineInputField = { key: string; label: string; type: "text" | "boolean" | "select" | "number"; required?: boolean; options?: { value: string; label: string }[] };
export type PipelineNode = {
  key: string; title: string; kind: "manual" | "document" | "approval" | "submission";
  dependsOn: string[]; requiresEvidence?: boolean; requiresUploadedEvidence?: boolean; packetKey?: string;
  condition?: { field: string; operator: "equals" | "not_equals" | "exists" | "in"; value?: PipelineScalar | PipelineScalar[] };
  approval?: { permission?: Permission; distinctInitiator?: boolean };
  submission?: { adapterId: string; officialUrl?: string };
};
export type PipelineGraph = { version: 1; inputFields?: PipelineInputField[]; nodes: PipelineNode[] };
export type PipelineStepState = "pending" | "completed" | "approved" | "rejected" | "queued" | "manual_required" | "submitted";
export type PipelineStep = { nodeKey: string; state: PipelineStepState; [key: string]: any };
export type PipelineNodeState = PipelineStepState | "ready" | "blocked" | "skipped";

const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/);
const scalar = z.union([z.string().max(20000), z.number().finite(), z.boolean(), z.null()]);
const conditionSchema = z.object({ field: key, operator: z.enum(["equals", "not_equals", "exists", "in"]), value: z.union([scalar, z.array(scalar).max(100)]).optional() }).strict();
const inputFieldSchema = z.object({ key, label: z.string().min(1).max(300), type: z.enum(["text", "boolean", "select", "number"]), required: z.boolean().optional(), options: z.array(z.object({ value: z.string().max(200), label: z.string().max(300) }).strict()).max(100).optional() }).strict();
const nodeSchema = z.object({
  key, title: z.string().min(1).max(300), kind: z.enum(["manual", "document", "approval", "submission"]), dependsOn: z.array(key).max(100),
  requiresEvidence: z.boolean().optional(), requiresUploadedEvidence: z.boolean().optional(), packetKey: key.optional(), condition: conditionSchema.optional(),
  approval: z.object({ permission: z.enum(["documents:write", "minutes:approve", "filings:submit", "tasks:write", "settings:manage"]).optional(), distinctInitiator: z.boolean().optional() }).strict().optional(),
  submission: z.object({ adapterId: key, officialUrl: z.string().url().max(2000).optional() }).strict().optional(),
}).strict();
const graphSchema = z.object({ version: z.literal(1), inputFields: z.array(inputFieldSchema).max(100).optional(), nodes: z.array(nodeSchema).min(1).max(100) }).strict();

/** Executable graphs are bounded declarative data, never scripts or arbitrary URLs. */
export function validatePipelineGraph(value: unknown): PipelineGraph {
  const graph = graphSchema.parse(value) as PipelineGraph;
  const nodes = new Map(graph.nodes.map(node => [node.key, node]));
  if (nodes.size !== graph.nodes.length) throw new Error("Pipeline node keys must be unique.");
  const fields = new Set((graph.inputFields ?? []).map(field => field.key));
  if (fields.size !== (graph.inputFields ?? []).length) throw new Error("Pipeline input keys must be unique.");
  for (const field of fields) if (["__proto__", "constructor", "prototype"].includes(field)) throw new Error("Invalid pipeline input key.");
  for (const node of graph.nodes) {
    if (new Set(node.dependsOn).size !== node.dependsOn.length) throw new Error("Duplicate pipeline dependency.");
    for (const dependency of node.dependsOn) if (!nodes.has(dependency)) throw new Error(`Unknown pipeline dependency: ${dependency}.`);
    if (node.condition && !fields.has(node.condition.field)) throw new Error("Pipeline condition must reference a declared input field.");
    if (node.condition?.operator === "in" && !Array.isArray(node.condition.value)) throw new Error("The in condition requires a list of scalar values.");
    if (node.condition && ["equals", "not_equals"].includes(node.condition.operator) && (node.condition.value === undefined || Array.isArray(node.condition.value))) throw new Error("Equality conditions require a scalar value.");
    if (node.kind === "submission" && !node.submission) throw new Error("A submission node requires an adapter identifier.");
    if (node.kind !== "submission" && node.submission) throw new Error("Only submission nodes may route submissions.");
    if (node.kind !== "approval" && node.approval) throw new Error("Only approval nodes may specify approval policy.");
    if (node.submission?.officialUrl && new URL(node.submission.officialUrl).protocol !== "https:") throw new Error("Official filing links require HTTPS.");
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (nodeKey: string) => {
    if (visiting.has(nodeKey)) throw new Error("Pipeline dependencies must not contain a cycle.");
    if (visited.has(nodeKey)) return;
    visiting.add(nodeKey);
    for (const dependency of nodes.get(nodeKey)!.dependsOn) visit(dependency);
    visiting.delete(nodeKey); visited.add(nodeKey);
  };
  for (const node of graph.nodes) visit(node.key);
  // A submission must pass an approval in its dependency ancestry; a client
  // cannot weaken this by arranging an unrelated review elsewhere in the graph.
  for (const node of graph.nodes.filter(node => node.kind === "submission")) {
    if (!pipelineAncestors(graph, node.key).some(ancestor => ancestor.kind === "approval")) throw new Error("Every submission requires a preceding approval dependency.");
  }
  return graph;
}

export function validatePipelineInputs(graph: PipelineGraph, value: unknown, complete = false): PipelineInputs {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pipeline inputs must be an object.");
  const fields = new Map((graph.inputFields ?? []).map(field => [field.key, field]));
  const output: PipelineInputs = {};
  for (const [name, entry] of Object.entries(value)) {
    const field = fields.get(name);
    if (!field || ["__proto__", "constructor", "prototype"].includes(name)) throw new Error(`Unknown pipeline input: ${name}.`);
    const parsed = scalar.parse(entry);
    if (field.type === "boolean" && typeof parsed !== "boolean") throw new Error(`${field.label} requires a boolean.`);
    if (field.type === "number" && typeof parsed !== "number") throw new Error(`${field.label} requires a finite number.`);
    if (["text", "select"].includes(field.type) && typeof parsed !== "string") throw new Error(`${field.label} requires text.`);
    if (field.type === "select" && !field.options?.some(option => option.value === parsed)) throw new Error(`${field.label} requires a listed option.`);
    output[name] = typeof parsed === "string" ? parsed.trim() : parsed;
  }
  if (complete) for (const field of fields.values()) {
    if (field.required && (output[field.key] === undefined || output[field.key] === null || output[field.key] === "")) throw new Error(`Complete required input: ${field.label}.`);
  }
  return output;
}

export function pipelineAncestors(graph: PipelineGraph, nodeKey: string): PipelineNode[] {
  const nodes = new Map(graph.nodes.map(node => [node.key, node]));
  const found = new Set<string>();
  const walk = (key: string) => { for (const dependency of nodes.get(key)?.dependsOn ?? []) if (!found.has(dependency)) { found.add(dependency); walk(dependency); } };
  walk(nodeKey);
  return graph.nodes.filter(node => found.has(node.key));
}

export function evaluatePipeline(graph: PipelineGraph, inputs: PipelineInputs, steps: PipelineStep[]): (PipelineNode & { state: PipelineNodeState; blockedReason?: string })[] {
  const recorded = new Map(steps.map(step => [step.nodeKey, step]));
  const derived = new Map<string, PipelineNode & { state: PipelineNodeState; blockedReason?: string }>();
  let inputError: string | undefined;
  try { validatePipelineInputs(graph, inputs, true); } catch (error) { inputError = (error as Error).message; }
  const visit = (node: PipelineNode): PipelineNode & { state: PipelineNodeState; blockedReason?: string } => {
    const existing = derived.get(node.key); if (existing) return existing;
    const record = recorded.get(node.key);
    const dependencies = node.dependsOn.map(key => visit(graph.nodes.find(entry => entry.key === key)!));
    let state: PipelineNodeState = "ready", blockedReason: string | undefined;
    if (record && record.state !== "pending") state = record.state;
    else if (inputError) { state = "blocked"; blockedReason = inputError; }
    else if (node.condition && !conditionMatches(node.condition, inputs)) state = "skipped";
    else if (dependencies.some(dependency => !["completed", "approved", "submitted", "skipped"].includes(dependency.state))) {
      state = "blocked"; blockedReason = `Complete dependencies: ${dependencies.filter(dependency => !["completed", "approved", "submitted", "skipped"].includes(dependency.state)).map(dependency => dependency.title).join(", ")}.`;
    }
    const result = { ...node, state, ...(blockedReason ? { blockedReason } : {}) };
    derived.set(node.key, result); return result;
  };
  return graph.nodes.map(visit);
}

function conditionMatches(condition: NonNullable<PipelineNode["condition"]>, inputs: PipelineInputs) {
  const current = inputs[condition.field];
  if (condition.operator === "exists") return current !== undefined && current !== null && current !== "";
  if (condition.operator === "equals") return current === condition.value;
  if (condition.operator === "not_equals") return current !== condition.value;
  return Array.isArray(condition.value) && condition.value.includes(current);
}

/** Canonical frozen JSON is shared by approvals, outbox routing and adapters. */
export function canonicalPipelineJson(value: unknown): string {
  const normalize = (entry: any): any => {
    if (entry === null || typeof entry !== "object") return entry;
    if (Array.isArray(entry)) return entry.map(normalize);
    return Object.fromEntries(Object.keys(entry).filter(key => entry[key] !== undefined).sort().map(key => [key, normalize(entry[key])]));
  };
  return JSON.stringify(normalize(value));
}

export async function pipelineSha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Skipped branch reviews never authorize submission; callers still require a nonempty result. */
export function activePipelineApprovals(graph: PipelineGraph, inputs: PipelineInputs, steps: PipelineStep[], submissionKey: string): PipelineNode[] {
  const states = evaluatePipeline(graph, inputs, steps);
  return pipelineAncestors(graph, submissionKey).filter(node => node.kind === "approval" && states.find(state => state.key === node.key)?.state !== "skipped");
}
