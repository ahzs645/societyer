import { LocalDexieRowStore, type LocalSeed, type LocalWorkspaceSnapshot } from "./localDexieRowStore";
import { byId } from "./staticConvexUtils";
import { society, tables, type StaticArgs } from "./staticConvexFixtures";

export type StaticDemoSeed = LocalSeed;

export const STATIC_DEMO_SEED: StaticDemoSeed = {
  ...tables,
  societies: [society],
};

/** Legacy facade around the Dexie row store used by the static Convex shim. */
export class StaticDemoDexieStore {
  private rowsStore: LocalDexieRowStore;

  constructor(seed: StaticDemoSeed, options?: { databaseName?: string }) {
    this.rowsStore = new LocalDexieRowStore(seed, {
      databaseName: options?.databaseName ?? "societyer-static-demo",
      logLabel: "societyer-demo",
    });
  }

  onUpdate(listener: () => void) {
    return this.rowsStore.onUpdate(listener);
  }

  /** The underlying row store — the LocalRowStore the portable ctx.db runs on. */
  get rowStore(): LocalDexieRowStore {
    return this.rowsStore;
  }

  queryResult(name: string, args: StaticArgs) {
    switch (name) {
      case "minutes:get":
        return this.getRow("minutes", args?.id);
    }
    return undefined;
  }

  mutationResult(_name: string, _args: StaticArgs) {
    return undefined;
  }

  listRows(table: string, args?: StaticArgs) {
    return this.rowsStore.listRows(table, args);
  }

  getRow(table: string, id: string | undefined) {
    return this.rowsStore.getRow(table, id);
  }

  upsertRow(table: string, row: any) {
    return this.rowsStore.upsertRow(table, row);
  }

  removeRow(table: string, id: string | undefined) {
    return this.rowsStore.removeRow(table, id);
  }

  async reseed() {
    await this.rowsStore.reseed();
  }

  async importSnapshot(snapshot: LocalWorkspaceSnapshot) {
    await this.rowsStore.importSnapshot(snapshot);
  }

  transaction<T>(mutate: () => T): T {
    return this.rowsStore.transaction(mutate);
  }

  exportSnapshot() {
    return this.rowsStore.exportSnapshot();
  }

  upsertAttachment(attachment: Parameters<LocalDexieRowStore["upsertAttachment"]>[0]) {
    return this.rowsStore.upsertAttachment(attachment);
  }

  private agendaRowForMeeting(meeting: any) {
    const rows = this.rows("agendas")
      .filter((row) => row.meetingId === meeting._id)
      .sort((a, b) => String(a.createdAtISO).localeCompare(String(b.createdAtISO)));
    return rows[0] ?? null;
  }

  private agendaSummaryForMeeting(meeting: any) {
    const existing = this.agendaRowForMeeting(meeting);
    if (existing) return existing;
    return {
      _id: `static_agenda_${meeting._id}`,
      societyId: meeting.societyId,
      meetingId: meeting._id,
      title: `${meeting.title} agenda`,
      status: "Draft",
      createdAtISO: meeting.scheduledAt,
      updatedAtISO: meeting.updatedAtISO ?? meeting.scheduledAt,
    };
  }

  private agendaForMeeting(meetingId: string | undefined) {
    const meeting = byId(this.rows("meetings"), meetingId);
    if (!meeting) return null;
    const agenda = this.agendaRowForMeeting(meeting);
    if (!agenda) return null;
    const items = this.rows("agendaItems")
      .filter((item) => item.agendaId === agenda._id)
      .sort((a, b) => a.order - b.order);
    if (items.length === 0) return null;
    return { agenda, items };
  }

  private rows(table: string) {
    return this.rowsStore.rows(table);
  }

  private patchRow(table: string, id: string | undefined, patch: Record<string, any>) {
    return this.rowsStore.patchRow(table, id, patch);
  }
}
