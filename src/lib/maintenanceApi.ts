import { authenticatedFetch } from "@/lib/authToken";
import type { Id } from "../../convex/_generated/dataModel";
import { STATIC_DEMO_SOCIETY_ID } from "./staticIds";
import { isLocalDataRuntime, isLocalDemoDataRuntime } from "./staticRuntime";
import type { CorporationDemoKey } from "../../shared/demoData/corporationIdentities";

type SeedResult = { societyId: Id<"societies"> };
type ResetResult = { ok: boolean };

/**
 * Whether demo seeding / wiping may be offered here. On-device it needs the
 * bundled demo store: reseeding a real local workspace would erase it. Server
 * deployments gate the maintenance endpoints themselves (local development only).
 */
export function canSeedDemoData() {
  return !isLocalDataRuntime() || isLocalDemoDataRuntime();
}

export async function seedDemoSociety(): Promise<SeedResult> {
  if (isLocalDataRuntime()) {
    await reseedLocalData();
    return { societyId: STATIC_DEMO_SOCIETY_ID as Id<"societies"> };
  }
  return postMaintenance<SeedResult>("seed");
}

export async function resetDemoData(): Promise<ResetResult> {
  if (isLocalDataRuntime()) {
    await reseedLocalData();
    return { ok: true };
  }
  return postMaintenance<ResetResult>("reset");
}

/**
 * Open the populated demo workspace of a corporation persona in the local
 * (in-browser) demo: generated on first use, reused afterwards. The generator
 * is loaded only when a persona is chosen, so it never weighs on app start.
 */
export async function seedCorporationDemoWorkspace(key: CorporationDemoKey): Promise<{ societyId: Id<"societies">; created: boolean }> {
  if (!isLocalDataRuntime()) throw new Error("Sample corporation workspaces are generated in the in-browser demo only.");
  const [{ localDataClient }, { buildCorporationDemo, corporationDemoLocalSeed }] = await Promise.all([
    import("./localDataClient"),
    import("../../shared/demoData/corporations"),
  ]);
  const demo = buildCorporationDemo(key);
  const result = await localDataClient.seedDemoWorkspace(demo.societyId, corporationDemoLocalSeed(demo));
  return { societyId: result.societyId as Id<"societies">, created: result.created };
}

export function maintenanceErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Local maintenance endpoint is unavailable. Run npm run convex:seed from the terminal.";
}

async function postMaintenance<T>(operation: "seed" | "reset"): Promise<T> {
  const response = await authenticatedFetch(`/api/v1/maintenance/${operation}`, {
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

async function reseedLocalData() {
  if (!isLocalDemoDataRuntime()) {
    throw new Error("Demo seeding is only available in the demo. This workspace holds your own records, so it was not changed.");
  }
  const { reseedLocalData: reseed } = await import("./localDataClient");
  await reseed();
}
