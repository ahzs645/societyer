import { useEffect, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { lowerLabel } from "../utils/lowerLabel";
import { useRegisterCommand } from "@/lib/commands";
import { ASK_FILTER_COMMAND_PREFIX, registerAskFilterTarget, setPendingAsk } from "@/lib/nlFilter/bridge";
import { useApplyAskFilter, useAskFilterModel } from "./RecordTableAskFilterModel";

/**
 * Sparkle "Ask" button in the table toolbar. Opens the filter editor with the
 * Ask box focused, and lets the command palette run "Filter <table> by: …"
 * against this table while it is mounted.
 */
export function RecordTableAskFilterButton() {
  const tableId = useRecordTableState((s) => s.tableId);
  const handle = useRecordTableStoreHandle();
  const { objectMetadata } = useRecordTableContextOrThrow();
  const { parse } = useAskFilterModel();
  const apply = useApplyAskFilter();
  const plural = lowerLabel(objectMetadata.labelPlural);
  const commandId = `${ASK_FILTER_COMMAND_PREFIX}${tableId}`;

  const open = (query = "", preview = false) => {
    setPendingAsk(tableId, { query, preview });
    handle.get().requestFilterEditor();
  };

  useRegisterCommand({
    id: commandId,
    label: `Filter ${plural} by…`,
    icon: Sparkles,
    category: "Actions",
    run: () => open(),
  });

  const target = useMemo(
    () => ({
      label: plural,
      preview: (query: string) => parse(query).status,
      run: (query: string) => {
        const result = parse(query);
        // Only a fully understood request applies straight from the palette;
        // anything else opens the preview so the person can see what's left out.
        if (result.status === "ok") apply(result, "merge");
        else open(query, true);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plural, parse, apply, tableId],
  );
  useEffect(() => registerAskFilterTarget(commandId, target), [commandId, target]);

  return (
    <button
      type="button"
      className="record-table__toolbar-button record-table__toolbar-button--ask"
      aria-label={`Ask to filter ${plural}`}
      title={`Describe the ${plural} to show`}
      onClick={() => open()}
    >
      <Sparkles size={12} aria-hidden="true" />
      <span>Ask</span>
    </button>
  );
}
