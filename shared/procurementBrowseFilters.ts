/** Pure scalar-field predicate shared with the hosted procurement query. No UI/runtime imports. */
import { isDateInRange, resolveDateRange } from "../src/lib/dateRanges";
type Condition = {
  id: string;
  fieldMetadataId: string;
  operator: string;
  value?: unknown;
  viewFilterGroupId?: string | null;
};
type Group = {
  id: string;
  parentViewFilterGroupId?: string | null;
  logicalOperator: string;
};
export function procurementPredicate(
  columns: any[],
  filters: Condition[],
  groups: Group[],
  dateContext: any,
) {
  const fields = new Map(
    columns.map((c) => [c.fieldMetadataId ?? c.field?._id, c.field]),
  );
  const compile =
    (f: Condition) =>
    (row: Record<string, unknown>): boolean => {
      const field = fields.get(f.fieldMetadataId);
      if (!field) return true;
      const value = row[field.name],
        target = f.value,
        text = String(value ?? "").toLowerCase(),
        expected = String(target ?? "").toLowerCase(),
        empty = value === null || value === undefined || value === "";
      switch (f.operator) {
        case "isEmpty":
          return empty;
        case "isNotEmpty":
          return !empty;
        case "isTrue":
          return value === true;
        case "isFalse":
          return value === false;
        case "contains":
          return text.includes(expected);
        case "notContains":
          return !text.includes(expected);
        case "startsWith":
          return text.startsWith(expected);
        case "endsWith":
          return text.endsWith(expected);
        case "between": {
          if (!target || typeof target !== "object") return true;
          const range = resolveDateRange(target as any, dateContext);
          return !range || isDateInRange(value, range);
        }
        case "eq":
        case "neq":
        case "in":
        case "notIn": {
          const match = (Array.isArray(target) ? target : [target]).some((t) =>
            typeof value === "number"
              ? value === Number(t)
              : text === String(t ?? "").toLowerCase(),
          );
          return f.operator === "neq" || f.operator === "notIn"
            ? !match
            : match;
        }
        case "gt":
        case "gte":
        case "lt":
        case "lte": {
          if (empty) return false;
          const a = typeof value === "number" ? value : text,
            b = typeof value === "number" ? Number(target) : expected;
          if (f.operator === "gt") return a > b;
          if (f.operator === "gte") return a >= b;
          if (f.operator === "lt") return a < b;
          return a <= b;
        }
        default:
          throw new Error("Unsupported procurement filter operator.");
      }
    };
  const roots = groups.filter((g) => !g.parentViewFilterGroupId);
  if (!roots.length) {
    const tests = filters.map(compile);
    return (row: Record<string, unknown>) => tests.every((t) => t(row));
  }
  const visit = (
    g: Group,
    seen: Set<string>,
  ): ((row: Record<string, unknown>) => boolean) => {
    if (seen.has(g.id)) throw new Error("Cyclic filter group.");
    const path = new Set(seen).add(g.id);
    const tests = [
      ...filters.filter((f) => f.viewFilterGroupId === g.id).map(compile),
      ...groups
        .filter((c) => c.parentViewFilterGroupId === g.id)
        .map((c) => visit(c, path)),
    ];
    return (row) =>
      !tests.length ||
      (g.logicalOperator === "or"
        ? tests.some((t) => t(row))
        : tests.every((t) => t(row)));
  };
  const tests = roots.map((g) => visit(g, new Set()));
  const ungrouped = filters.filter((f) => !f.viewFilterGroupId).map(compile);
  return (row: Record<string, unknown>) =>
    [...tests, ...ungrouped].every((t) => t(row));
}
