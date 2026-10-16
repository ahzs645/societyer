/**
 * Inline table edits of a role holder. The share/right class is stored twice:
 * by name (what the table shows and edits) and by id (what voting power and
 * the share register use). Changing the name must keep the two in step, as
 * the role holder drawer does: link the class whose name was typed, or drop
 * the old id when the name matches no class.
 */
export type RoleHolderClassOption = { _id: string; className: string };

export function roleHolderInlinePatch<T extends { membershipClassName?: string; membershipClassId?: unknown }>(
  record: T,
  fieldName: string,
  value: unknown,
  classes: readonly RoleHolderClassOption[] | undefined,
): T {
  const next = { ...record, [fieldName]: value } as T;
  if (fieldName !== "membershipClassName") return next;
  const name = typeof value === "string" ? value.trim() : "";
  const previous = (record.membershipClassName ?? "").trim();
  if (name && name.toLowerCase() === previous.toLowerCase() && record.membershipClassId) {
    // Only spacing or case changed: the same class.
    return next;
  }
  const match = name
    ? classes?.find((option) => option.className.trim().toLowerCase() === name.toLowerCase())
    : undefined;
  return { ...next, membershipClassId: match ? match._id : undefined };
}
