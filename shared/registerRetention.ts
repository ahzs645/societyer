/**
 * Purge guard for statutory registers. A corporation keeps its securities
 * register and its articles/incorporation history permanently (the governing
 * profile's records catalog marks them "lasting": BCA ss. 42-44, CBCA s. 20,
 * OBCA s. 140). Deleting a posted share transaction, an issued certificate or
 * a name/constating history entry would erase that history, so it is refused;
 * the row is voided, cancelled or end-dated instead.
 *
 * A row entered in the last 24 hours may still be deleted as a data-entry
 * correction. Societies and organizations without a reviewed profile are
 * unaffected. Pure module.
 */

import { legalGovernanceProfile } from "./legalGovernanceProfiles";

export const REGISTER_CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000;

type GuardedTable = "rightsholdingTransfers" | "shareCertificates" | "societyNameHistory" | "constatingEvents";

const RECORD_KEYS: Record<GuardedTable, readonly string[]> = {
  rightsholdingTransfers: ["securities_register"],
  shareCertificates: ["securities_register"],
  societyNameHistory: ["articles_and_incorporation", "certificates_orders_predecessors", "governing_documents"],
  constatingEvents: ["articles_and_incorporation", "certificates_orders_predecessors", "governing_documents"],
};

const INSTEAD: Record<GuardedTable, string> = {
  rightsholdingTransfers: "Void the transaction instead (status \"void\"), or post a correcting transaction.",
  shareCertificates: "Record the certificate as cancelled instead.",
  societyNameHistory: "Record an end date for the name instead.",
  constatingEvents: "Record an end date for the event instead.",
};

/** Rows of these tables that are part of the permanent statutory record. */
function isStatutoryRow(table: GuardedTable, row: Record<string, any>): boolean {
  if (table === "rightsholdingTransfers") return String(row.status ?? "").toLowerCase() === "posted";
  return true;
}

/** Null when the row may be deleted, otherwise the reason it must be kept. */
export function registerDeletionBlock(organization: any, table: string, row: Record<string, any> | null | undefined, now = Date.now()): string | null {
  if (!row || !(table in RECORD_KEYS)) return null;
  const guarded = table as GuardedTable;
  const profile = legalGovernanceProfile(organization);
  if (!profile || profile.kind !== "corporation") return null;
  const lasting = profile.records.find((record) => RECORD_KEYS[guarded].includes(record.key) && /complete historical corporate record/i.test(record.retention));
  if (!lasting || !isStatutoryRow(guarded, row)) return null;
  const created = Date.parse(String(row.createdAtISO ?? ""));
  if (Number.isFinite(created) && now - created >= 0 && now - created < REGISTER_CORRECTION_WINDOW_MS) return null;
  return `This entry is part of the ${lasting.label.toLowerCase()}, which is kept permanently (${profile.name}). ${INSTEAD[guarded]} Entries made in the last 24 hours can still be deleted to correct a mistake.`;
}

export function assertRegisterRowMayBeDeleted(organization: any, table: string, row: Record<string, any> | null | undefined, now = Date.now()): void {
  const block = registerDeletionBlock(organization, table, row, now);
  if (block) throw new Error(block);
}
