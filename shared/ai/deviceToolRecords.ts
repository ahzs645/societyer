/**
 * What the on-device assistant did with tools in one reply, saved with the
 * reply (`aiMessages.toolCalls`, through `aiChat:appendDeviceMessage`) so the
 * chat can show "Looked up: meetings (12) · transcript 0:00–5:00" and the
 * approval card for a proposed change after a reload.
 *
 * Records hold a summary, the arguments and a short preview of the result,
 * never the whole result. A proposed change keeps its full arguments: they
 * are what runs when the person approves it.
 */
import { z } from "zod";

export const DEVICE_TOOL_STATUSES = ["running", "complete", "error", "refused", "proposed", "executed", "dismissed"] as const;
export type DeviceToolStatus = (typeof DEVICE_TOOL_STATUSES)[number];

export const DEVICE_TOOL_RECORD_LIMITS = {
  perMessage: 16,
  id: 120,
  name: 64,
  summary: 240,
  /** Enough for the largest proposal a change tool accepts (8 tasks with descriptions). */
  argsJson: 24_000,
  resultPreview: 2_000,
} as const;

export const deviceToolRecordSchema = z.object({
  id: z.string().min(1).max(DEVICE_TOOL_RECORD_LIMITS.id),
  name: z.string().min(1).max(DEVICE_TOOL_RECORD_LIMITS.name),
  kind: z.enum(["read", "draft", "write", "unknown"]),
  status: z.enum(DEVICE_TOOL_STATUSES),
  summary: z.string().max(DEVICE_TOOL_RECORD_LIMITS.summary),
  argsJson: z.string().max(DEVICE_TOOL_RECORD_LIMITS.argsJson),
  resultPreview: z.string().max(DEVICE_TOOL_RECORD_LIMITS.resultPreview).optional(),
  /** On an approval or dismissal: the id of the proposal it settles. */
  resolves: z.string().max(DEVICE_TOOL_RECORD_LIMITS.id).optional(),
});

export type DeviceToolRecord = z.infer<typeof deviceToolRecordSchema>;

/** Valid records only (anything else is dropped), at most `perMessage`. "running" is never saved. */
export function parseDeviceToolRecords(value: unknown): DeviceToolRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => deviceToolRecordSchema.safeParse(entry))
    .flatMap((parsed) => (parsed.success && parsed.data.status !== "running" ? [parsed.data] : []))
    .slice(0, DEVICE_TOOL_RECORD_LIMITS.perMessage);
}

/** Cuts a string to `max` characters, marking the cut. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
