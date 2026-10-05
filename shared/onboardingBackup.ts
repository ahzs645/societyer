export const MAX_SETUP_BACKUP_BYTES = 100 * 1024 * 1024;

/** Validate and summarize local snapshot structure before asking to replace device records. */
export function validateSetupBackup(snapshot: any): void {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !snapshot.tables || typeof snapshot.tables !== "object" || Array.isArray(snapshot.tables)) throw new Error("Choose a Societyer workspace JSON backup.");
  if (snapshot.kind !== undefined && snapshot.kind !== "societyer.localWorkspaceSnapshot") throw new Error("This file is not a supported Societyer local workspace backup.");
  const entries = Object.entries(snapshot.tables);
  if (entries.length > 500) throw new Error("The backup contains too many tables for a device restore.");
  let count = 0;
  for (const [table, rows] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(table) || ["constructor", "prototype", "__proto__"].includes(table) || !Array.isArray(rows)) throw new Error("The backup contains an invalid record table.");
    count += rows.length;
    if (count > 200_000) throw new Error("The backup exceeds the 200,000-record device restore limit.");
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof row._id !== "string" || !row._id || row._id.length > 300 || ids.has(row._id)) throw new Error(`Backup table ${table} contains invalid or duplicate records.`);
      ids.add(row._id);
    }
  }
  if (!Array.isArray(snapshot.tables.societies) || !snapshot.tables.societies.length || snapshot.tables.societies.some((row: any) => typeof row.name !== "string" || !row.name.trim())) throw new Error("This backup has no organization to restore. Choose an exported organization workspace.");
  if (snapshot.attachments !== undefined) {
    if (!Array.isArray(snapshot.attachments) || snapshot.attachments.length > 50_000) throw new Error("The backup has invalid or excessive attachment references.");
    const keys = new Set<string>();
    for (const attachment of snapshot.attachments) {
      if (!attachment || typeof attachment !== "object" || Array.isArray(attachment) || typeof attachment.key !== "string" || !attachment.key || keys.has(attachment.key) || typeof attachment.provider !== "string" || !attachment.provider || typeof attachment.storageKey !== "string" || !attachment.storageKey || (attachment.fileSizeBytes !== undefined && (!Number.isSafeInteger(attachment.fileSizeBytes) || attachment.fileSizeBytes < 0))) throw new Error("The backup contains an invalid attachment reference.");
      keys.add(attachment.key);
    }
  }
}
