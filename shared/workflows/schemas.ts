import { z } from "zod";

export const workflowProviderSchema = z.enum(["internal", "n8n"]);
export type WorkflowProvider = z.infer<typeof workflowProviderSchema>;

export const workflowStatusSchema = z.enum(["active", "paused", "archived"]);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

export const workflowRunStatusSchema = z.enum([
  "queued",
  "running",
  "success",
  "failed",
  "manual_required",
]);
export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;

export const workflowRunStepStatusSchema = z.enum(["pending", "running", "ok", "fail", "skip"]);
export type WorkflowRunStepStatus = z.infer<typeof workflowRunStepStatusSchema>;

export const workflowTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("manual"),
  }),
  z.object({
    kind: z.literal("cron"),
    cron: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("date_offset"),
    offset: z.object({
      anchor: z.string().trim().min(1),
      anchorId: z.string().trim().optional(),
      daysBefore: z.number().int().min(0).max(3660),
    }),
  }),
]);
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>;

export const workflowNodeTypeSchema = z.enum([
  "manual_trigger",
  "form",
  "pdf_fill",
  "document_create",
  "email",
  "external_n8n",
]);
export type WorkflowNodeType = z.infer<typeof workflowNodeTypeSchema>;

export const workflowNodeSchema = z.object({
  key: z.string().trim().min(1),
  type: workflowNodeTypeSchema,
  label: z.string().trim().min(1),
  description: z.string().optional(),
  status: z.enum(["draft", "ready", "needs_setup"]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowRunStepSchema = z.object({
  key: z.string().optional(),
  label: z.string().trim().min(1),
  status: workflowRunStepStatusSchema,
  atISO: z.string().optional(),
  note: z.string().optional(),
});
export type WorkflowRunStep = z.infer<typeof workflowRunStepSchema>;

export const workflowRunStateSchema = z.object({
  status: workflowRunStatusSchema,
  startedAtISO: z.string(),
  completedAtISO: z.string().optional(),
  steps: z.array(workflowRunStepSchema),
  output: z.unknown().optional(),
});
export type WorkflowRunState = z.infer<typeof workflowRunStateSchema>;

export function parseWorkflowTrigger(value: unknown): WorkflowTrigger {
  return workflowTriggerSchema.parse(value);
}

export function parseWorkflowNodes(value: unknown): WorkflowNode[] {
  return z.array(workflowNodeSchema).parse(value ?? []);
}

export function parseWorkflowStatus(value: unknown): WorkflowStatus {
  return workflowStatusSchema.parse(value);
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function extractWorkflowVariablePaths(template: string): string[] {
  const paths = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    if (match[1]) paths.add(match[1]);
  }
  return Array.from(paths);
}

export function interpolateWorkflowVariables(
  template: string,
  context: Record<string, unknown>,
) {
  return template.replace(VARIABLE_PATTERN, (_, path: string) => {
    const value = getPath(context, path);
    return value === null || value === undefined ? "" : String(value);
  });
}

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}
