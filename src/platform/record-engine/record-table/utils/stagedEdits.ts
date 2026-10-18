/*
 * Batch-mode changeset for RecordTable grid edits: values typed or pasted
 * but not saved yet, keyed by record id then field name. Shown over the
 * records (and sorted/filtered with them) until saved or discarded. Pure.
 */

export type StagedEdits = Map<string, Map<string, unknown>>;

export type StagedWrite = { recordId: string; fieldName: string; value: unknown };

function sameStoredValue(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true;
  const blank = (value: unknown) => value === null || value === undefined || value === "";
  if (blank(a) && blank(b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Adds writes to the changeset. A write back to the saved value removes the
 * cell from it, so typing the old value again leaves nothing pending.
 */
export function stageWrites(staged: StagedEdits, writes: StagedWrite[], savedValue: (recordId: string, fieldName: string) => unknown): StagedEdits {
  if (writes.length === 0) return staged;
  const next: StagedEdits = new Map(staged);
  for (const write of writes) {
    const fields = new Map(next.get(write.recordId) ?? []);
    if (sameStoredValue(savedValue(write.recordId, write.fieldName), write.value)) fields.delete(write.fieldName);
    else fields.set(write.fieldName, write.value);
    if (fields.size > 0) next.set(write.recordId, fields);
    else next.delete(write.recordId);
  }
  return next;
}

export function stagedCount(staged: StagedEdits) {
  let count = 0;
  for (const fields of staged.values()) count += fields.size;
  return count;
}

export function stagedList(staged: StagedEdits): StagedWrite[] {
  const list: StagedWrite[] = [];
  for (const [recordId, fields] of staged) {
    for (const [fieldName, value] of fields) list.push({ recordId, fieldName, value });
  }
  return list;
}

/** Records with the pending changeset laid over them. */
export function applyStagedEdits<T extends { _id?: unknown }>(records: T[], staged: StagedEdits): T[] {
  if (staged.size === 0) return records;
  return records.map((record) => {
    const fields = staged.get(String(record?._id));
    if (!fields) return record;
    return { ...record, ...Object.fromEntries(fields) };
  });
}
