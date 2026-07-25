export type SubjectIdArgs = {
  subjectId?: string;
  /** @deprecated H0 transition alias. Prefer subjectId. */
  entityId?: string;
};

export function requireSubjectId(args: SubjectIdArgs): string {
  const subjectId = args.subjectId ?? args.entityId;
  if (!subjectId) throw new Error("subjectId is required");
  return subjectId;
}

export function optionalSubjectId(value: { subjectId?: unknown; entityId?: unknown; _id?: unknown }): string | undefined {
  if (typeof value.subjectId === "string" && value.subjectId) return value.subjectId;
  if (typeof value.entityId === "string" && value.entityId) return value.entityId;
  return undefined;
}
