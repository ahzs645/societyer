import type { PowerSyncDatabase } from "@powersync/web";
import type { Scope } from "./database";
import { hydrateMeetingSnapshots } from "./meetingStore";
import type { Snapshot } from "../../shared/offline/meetingProtocol";

/** Clear server-derived content even when an edited downloaded meeting has a
 * pending command. Authored command bodies remain in history for recovery. */
export async function purgeDownloadedPreparation(db: PowerSyncDatabase) {
  await db.writeTransaction(async tx => {
    const rows = await tx.getAll<{ id: string; mappings: string }>("SELECT id, mappings FROM meetingLocalState WHERE origin = 'downloaded'");
    for (const row of rows) {
      for (const mapping of JSON.parse(row.mappings)) await tx.execute("DELETE FROM portableMeetingRows WHERE id = ?", [mapping.nativeId]);
      await tx.execute("DELETE FROM meetingLocalState WHERE id = ?", [row.id]);
    }
    await tx.execute("DELETE FROM meetingFiles WHERE origin = 'downloaded'");
    await tx.execute("DELETE FROM fixtureMeetingSnapshots");
  });
}

/** Native reactive authorization supplies a second, independent fence when
 * pending SDK writes delay a replication checkpoint containing ACL deletion. */
export async function reconcileAuthorizedPreparation(db: PowerSyncDatabase, scope: Scope, snapshots: Snapshot[]) {
  await db.writeTransaction(async tx => {
    const allowed = new Set(snapshots.map(row => row.meetingUuid));
    const rows = await tx.getAll<{ id: string; mappings: string }>("SELECT id, mappings FROM meetingLocalState WHERE origin = 'downloaded'");
    for (const row of rows) {
      if (allowed.has(row.id)) continue;
      for (const mapping of JSON.parse(row.mappings)) await tx.execute("DELETE FROM portableMeetingRows WHERE id = ?", [mapping.nativeId]);
      await tx.execute("DELETE FROM meetingLocalState WHERE id = ?", [row.id]);
    }
  });
  await hydrateMeetingSnapshots(db, scope, snapshots);
}
