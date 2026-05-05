import type { Id } from "../../convex/_generated/dataModel";
import { STATIC_DEMO_SOCIETY_ID } from "./staticIds";
import { isStaticDemoRuntime } from "./staticRuntime";

type SeedResult = { societyId: Id<"societies"> };
type ResetResult = { ok: boolean };

export async function seedDemoSociety(): Promise<SeedResult> {
  if (isStaticDemoRuntime()) {
    return { societyId: STATIC_DEMO_SOCIETY_ID as Id<"societies"> };
  }
  return postMaintenance<SeedResult>("seed");
}

export async function resetDemoData(): Promise<ResetResult> {
  if (isStaticDemoRuntime()) return { ok: true };
  return postMaintenance<ResetResult>("reset");
}

export function maintenanceErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Local maintenance endpoint is unavailable. Run npm run convex:seed from the terminal.";
}

async function postMaintenance<T>(operation: "seed" | "reset"): Promise<T> {
  const response = await fetch(`/api/v1/maintenance/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body?.error?.message ??
      "Local maintenance endpoint is unavailable. Run npm run convex:seed from the terminal.";
    throw new Error(message);
  }

  return (await response.json()) as T;
}
