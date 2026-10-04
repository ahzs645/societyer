import { UpdateType, type PowerSyncBackendConnector, type PowerSyncDatabase } from "@powersync/web";
import { makeFunctionReference } from "convex/server";
import type { ConvexReactClient } from "convex/react";
import type { Scope } from "./database";
import { validateCommand, type Download, type MeetingCommand, type MeetingResult } from "./meetingProtocol";
import { hydrateMeetingSnapshots } from "./meetingStore";

export type MeetingTransport = { applyCommand(args: { societyId: string; command: MeetingCommand }): Promise<MeetingResult> };
export function convexMeetingTransport(client: ConvexReactClient): MeetingTransport {
  const reference = makeFunctionReference<"mutation", { societyId: string; command: MeetingCommand }, MeetingResult>("offlineMeetings:applyCommand");
  return { applyCommand: args => client.mutation(reference, args) };
}
export class MeetingConnector implements PowerSyncBackendConnector {
  constructor(readonly scope: Scope, private readonly transport: MeetingTransport, private readonly isCurrent: () => boolean,
    private readonly credentials?: () => Promise<{ endpoint: string; token: string }>) {}
  async fetchCredentials() {
    if (!this.isCurrent() || !this.credentials) throw new Error("No current live PowerSync session.");
    const credentials = await this.credentials();
    if (!this.isCurrent()) throw new Error("Session changed.");
    return credentials;
  }
  async uploadData(db: PowerSyncDatabase) {
    if (!this.isCurrent()) throw new Error("Session changed.");
    const transaction = await db.getNextCrudTransaction();
    if (!transaction) return;
    // One domain command produces multiple local rows, but only one queue entry.
    if (transaction.crud.length !== 1) throw new Error("Unsupported pilot command group.");
    const entry = transaction.crud[0];
    if (entry.table !== "offlineMeetingCommands" || entry.op !== UpdateType.PUT) throw new Error("Unsupported pilot table or operation.");
    const metadata = JSON.parse(entry.metadata ?? "null");
    if (!metadata || JSON.stringify(metadata.scope) !== JSON.stringify(this.scope) || metadata.command.operationId !== entry.id) throw new Error("Offline command scope mismatch.");
    const command: MeetingCommand = metadata.command;
    let result: MeetingResult;
    try { validateCommand(command); result = await this.transport.applyCommand({ societyId: this.scope.societyId, command }); }
    catch (error) {
      if (this.isCurrent()) await db.execute("UPDATE meetingCommandHistory SET state = 'review', result = ? WHERE id = ?", [error instanceof Error ? error.message : String(error), entry.id]);
      throw error; // Durable queue and dependent work remain intact.
    }
    if (!this.isCurrent()) throw new Error("Session changed; acknowledgement retained for replay.");
    if (!result.accepted) throw new Error("Command was not accepted.");
    // Persist stable/native mapping with acceptance before acknowledging. If
    // interrupted anywhere here, the server receipt makes the next retry safe.
    await db.execute("UPDATE meetingCommandHistory SET state = 'accepted', result = ? WHERE id = ?", [JSON.stringify(result), entry.id]);
    if (!this.isCurrent()) throw new Error("Session changed; acknowledgement retained for replay.");
    await transaction.complete();
  }
}

/** Call from the EXISTING authenticated session lifecycle after live setup. */
export async function connectMeetingPilot(db: PowerSyncDatabase, scope: Scope, client: ConvexReactClient,
  isCurrent: () => boolean, credentials: () => Promise<{ endpoint: string; token: string }>, onError: (error: unknown) => void,
  protectedMeetings: () => ReadonlySet<string> = () => new Set()) {
  const identity = await client.query(makeFunctionReference<"query", { societyId: string }, { actorKey: string; societyId: string }>("offlineMeetings:syncIdentity"), { societyId: scope.societyId });
  if (!isCurrent() || identity.actorKey !== `${scope.issuer}|${scope.subject}` || identity.societyId !== scope.societyId) throw new Error("Live session scope mismatch.");
  const connector = new MeetingConnector(scope, convexMeetingTransport(client), isCurrent, credentials);
  const abort = new AbortController();
  db.watch("SELECT * FROM offlineMeetingDownloads", [], { onResult: result => {
    if (!isCurrent()) return;
    const rows: Download[] = result.rows?._array ?? [];
    if (rows.some(row => row.actor_key !== identity.actorKey || row.society_id !== scope.societyId)) { onError(new Error("Replicated row scope mismatch.")); return; }
    void hydrateMeetingSnapshots(db, scope, rows.map(row => JSON.parse(row.payload)), protectedMeetings()).catch(onError);
  }, onError }, { signal: abort.signal });
  try { await db.connect(connector); }
  catch (error) { abort.abort(); throw error; }
  return async () => { abort.abort(); await db.disconnect(); await db.close(); };
}
