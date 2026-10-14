import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useRecordTableContextOrThrow } from "@/platform/record-engine/record-table/contexts/RecordTableContext";
import { useRecordTableState, useRecordTableStoreHandle } from "@/platform/record-engine/record-table/state/recordTableStore";
import type { ViewFilter } from "@/platform/record-engine/types/View";
import { readTransactionLink, withoutTransactionLink, type TransactionLinkSpec } from "./transactionFilterLink";

function filtersFor(spec: TransactionLinkSpec, fieldId: (name: string) => string | undefined): ViewFilter[] {
  const filters: ViewFilter[] = [];
  const add = (name: string, filter: Omit<ViewFilter, "fieldMetadataId" | "id">) => {
    const fieldMetadataId = fieldId(name);
    if (fieldMetadataId) filters.push({ id: `link-${name}-${filters.length}`, fieldMetadataId, ...filter });
  };
  if (spec.field) {
    if (spec.value) add(spec.field, { operator: "eq", value: spec.value });
    else add(spec.field, { operator: "isEmpty", value: null });
  }
  if (spec.flow === "out") add("amountCents", { operator: "lt", value: 0 });
  if (spec.flow === "in") add("amountCents", { operator: "gt", value: 0 });
  if (spec.from || spec.to) add("date", { operator: "between", value: { preset: "custom", start: spec.from, end: spec.to } });
  return filters;
}

/**
 * Applies an overview deep link (top payee, top category) to the
 * Transactions table as regular, removable filters. Renders nothing; mount
 * it inside the table's <RecordTableScope>.
 */
export function TransactionLinkFilters() {
  const [params, setParams] = useSearchParams();
  const { objectMetadata } = useRecordTableContextOrThrow();
  const store = useRecordTableStoreHandle();
  // Wait for the saved view to load, or loading it would wipe the filters.
  const viewId = useRecordTableState((state) => state.viewId);
  const spec = readTransactionLink(params);
  const specKey = spec ? JSON.stringify(spec) : "";

  useEffect(() => {
    if (!specKey || !viewId) return;
    const link = JSON.parse(specKey) as TransactionLinkSpec;
    const byName = new Map(objectMetadata.fields.map((field) => [field.name, String(field._id)]));
    const filters = filtersFor(link, (name) => byName.get(name));
    // Run after the scope's own view-loading effect in this commit.
    const timer = window.setTimeout(() => {
      store.set({ filters, filterGroups: [], searchTerm: "", anyFieldFilterValue: "" });
      setParams((prev) => withoutTransactionLink(prev), { replace: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [objectMetadata.fields, setParams, specKey, store, viewId]);

  return null;
}
