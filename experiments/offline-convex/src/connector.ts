import { UpdateType, type PowerSyncBackendConnector, type PowerSyncDatabase } from "@powersync/web";
import { makeFunctionReference } from "convex/server";
import type { ConvexReactClient } from "convex/react";
import type { Scope } from "./database";

export type Batch = { societyId: string; batchId: string; operations: { id: string; baseRevision: number; title: string; content: string }[] };
export type DraftTransport = { applyBatch(batch: Batch): Promise<{ accepted: boolean }> };

export function convexTransport(client: ConvexReactClient): DraftTransport {
  // The application owns Clerk/Better Auth and client.setAuth. No new auth system.
  const reference = makeFunctionReference<"mutation", Batch, { accepted: boolean }>("offlineDrafts:applyBatch");
  return { applyBatch: batch => client.mutation(reference, batch) };
}

/** Application adapter only; persistence, transactions and queue ownership stay in PowerSync. */
export class DraftConnector implements PowerSyncBackendConnector {
  constructor(
    readonly scope: Scope,
    private readonly transport: DraftTransport,
    private readonly isCurrent: () => boolean,
    private readonly credentials?: () => Promise<{ endpoint: string; token: string }>,
  ) {}
  async fetchCredentials() {
    if (!this.isCurrent()) throw new Error("Session changed.");
    if (!this.credentials) throw new Error("PowerSync service credentials are not configured in fixture mode.");
    const value = await this.credentials();
    if (!this.isCurrent()) throw new Error("Session changed.");
    return value;
  }
  async uploadData(db: PowerSyncDatabase) {
    if (!this.isCurrent()) throw new Error("Session changed.");
    const transaction = await db.getNextCrudTransaction();
    if (!transaction) return;
    const operations: Batch["operations"] = [];
    const ids: string[] = [];
    for (const entry of transaction.crud) {
      if (entry.table !== "offlineDrafts" || ![UpdateType.PUT, UpdateType.PATCH].includes(entry.op)) throw new Error("Unsupported offline operation.");
      const metadata = JSON.parse(entry.metadata ?? "null");
      if (!metadata || JSON.stringify(metadata.scope) !== JSON.stringify(this.scope) || typeof metadata.operationId !== "string" ||
          !Number.isInteger(metadata.baseRevision) || typeof metadata.title !== "string" || typeof metadata.content !== "string") {
        throw new Error("Offline operation scope or metadata mismatch.");
      }
      ids.push(metadata.operationId);
      operations.push({ id: entry.id, baseRevision: metadata.baseRevision, title: metadata.title, content: metadata.content });
    }
    const batchId = ids[0]; // Persisted operation ID, stable through lost acknowledgements and app restarts.
    const result = await this.transport.applyBatch({ societyId: this.scope.societyId, batchId, operations });
    if (!this.isCurrent()) throw new Error("Session changed; acknowledgement retained for idempotent replay.");
    if (!result.accepted) throw new Error("Upload was not accepted.");
    // Errors leave the durable transaction intact, including authorization and revision errors.
    await transaction.complete();
  }
}
