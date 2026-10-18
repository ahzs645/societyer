import { useState } from "react";
import { useMutation } from "convex/react";
import { CheckCheck, Download, Landmark, RotateCcw, Tag, Tags, Zap } from "lucide-react";
import { api } from "@/lib/convexApi";
import { RecordTableBulkBar, useRecordTableStoreHandle } from "@/platform/record-engine";
import { Modal } from "../../../components/Modal";
import { Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { useToast } from "../../../components/Toast";
import { pluralize } from "../../../lib/format";
import { downloadDelimitedText, exportFileName, toDelimitedText } from "../../../lib/tableExport";
import { draftFromSelection, selectionPayees, SELECTION_RULE_MAX_PAYEES } from "./selectionRuleDraft";
import { useRuleDrawer } from "./RuleDrawerHost";
import { useTransactionBulkEdit } from "./useTransactionBulkEdit";
import type { FinanceTagsApi } from "./useFinanceTags";
import { booksLockedNote, restoredMessage } from "./booksLockNote";

type BulkRow = {
  _id: string;
  date: string;
  description: string;
  counterparty?: string;
  rawCounterparty?: string;
  amountCents: number;
  account?: string;
  category?: string;
  memo?: string;
  receiptStatus?: string;
};

type Pending = { kind: "category" | "fund" | "tag"; ids: string[] } | null;

type TagResult = { updated: number; skipped: number; skippedLocked?: number; previous: Array<{ id: string; values: Record<string, unknown> }> };

/** "remove:<groupId>" in the tag picker clears that group's tag. */
const REMOVE_PREFIX = "remove:";

/**
 * The floating bulk island for the transactions table: set a category, mark
 * reviewed or unreviewed, assign a fund or a tag, create a rule from the
 * selection, or export it. Every change shows Undo.
 */
export function TransactionsBulkBar({ societyId, canWrite, exportName, tags }: { societyId: string; canWrite: boolean; exportName: string; tags: FinanceTagsApi }) {
  const drawer = useRuleDrawer();
  const handle = useRecordTableStoreHandle();
  const runBulk = useTransactionBulkEdit(societyId);
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [category, setCategory] = useState("");
  const [fundId, setFundId] = useState("");
  const [tagChoice, setTagChoice] = useState("");
  const assignTag = useMutation(api.transactionLines.assignTag);
  const restore = useMutation(api.financialHub.restoreTransactions);
  const funds = drawer?.workspace?.fundRestrictions ?? [];
  const categories = drawer?.workspace?.categories ?? [];

  const close = () => {
    setPending(null);
    setCategory("");
    setFundId("");
    setTagChoice("");
  };

  const runAssignTag = async (ids: string[], choice: string) => {
    const removing = choice.startsWith(REMOVE_PREFIX);
    const groupId = removing ? choice.slice(REMOVE_PREFIX.length) : undefined;
    const tag = removing ? undefined : tags.tag(choice);
    try {
      const result = (await assignTag({ societyId, ids, tagId: removing ? null : choice, ...(groupId ? { groupId } : {}) })) as TagResult;
      const lockedNote = booksLockedNote(result.skippedLocked);
      if (result.updated === 0) {
        toast.info("Nothing changed", lockedNote ?? (removing ? "None of the selected transactions had a tag from that group." : `The selected transactions already have ${tag?.name ?? "that tag"}.`));
        return;
      }
      toast.success(
        removing ? `Removed the ${tags.group(groupId!)?.name ?? "group"} tag from ${pluralize(result.updated, "transaction")}` : `Tagged ${pluralize(result.updated, "transaction")} ${tag?.name ?? ""}`.trim(),
        {
          description: lockedNote,
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: () => {
              void restore({ societyId, rows: result.previous })
                .then((undone) => toast.info(...restoredMessage(undone)))
                .catch((error: unknown) => toast.error("Could not undo", error instanceof Error ? error.message : undefined));
            },
          },
        },
      );
    } catch (error) {
      toast.error("Could not tag the transactions", error instanceof Error ? error.message : undefined);
    }
  };
  const finish = () => {
    close();
    handle.get().clearSelection();
  };

  const exportRows = (rows: BulkRow[]) => {
    const header = ["Date", "Description", "To / from", "Amount", "Account", "Category", "Notes", "Receipt"];
    const body = rows.map((row) => [
      row.date,
      row.description,
      row.counterparty ?? "",
      (row.amountCents / 100).toFixed(2),
      row.account ?? "",
      row.category ?? "",
      row.memo ?? "",
      row.receiptStatus ?? "",
    ]);
    const fileName = exportFileName(`${exportName} selection`, "csv");
    downloadDelimitedText(fileName, toDelimitedText([header, ...body], "csv"), "csv");
    toast.success(`Exported ${pluralize(rows.length, "transaction")}`, fileName);
  };

  const actions = [
    ...(canWrite
      ? [
          {
            id: "bulk-category",
            label: "Set category…",
            icon: <Tag size={12} aria-hidden="true" />,
            keepSelection: true,
            onRun: (ids: string[]) => setPending({ kind: "category", ids }),
          },
          {
            id: "bulk-reviewed",
            label: "Mark reviewed",
            icon: <CheckCheck size={12} aria-hidden="true" />,
            onRun: (ids: string[]) => runBulk(ids, { reviewed: true }, (count) => `Marked ${pluralize(count, "transaction")} as reviewed`),
          },
          {
            id: "bulk-unreviewed",
            label: "Mark unreviewed",
            icon: <RotateCcw size={12} aria-hidden="true" />,
            onRun: (ids: string[]) => runBulk(ids, { reviewed: false }, (count) => `Moved ${pluralize(count, "transaction")} back to To review`),
          },
          ...(tags.options.length > 0
            ? [
                {
                  id: "bulk-tag",
                  label: "Assign tag…",
                  icon: <Tags size={12} aria-hidden="true" />,
                  keepSelection: true,
                  onRun: (ids: string[]) => setPending({ kind: "tag", ids }),
                },
              ]
            : []),
          ...(funds.length > 0
            ? [
                {
                  id: "bulk-fund",
                  label: "Assign fund…",
                  icon: <Landmark size={12} aria-hidden="true" />,
                  keepSelection: true,
                  onRun: (ids: string[]) => setPending({ kind: "fund", ids }),
                },
              ]
            : []),
          ...(drawer
            ? [
                {
                  id: "bulk-rule",
                  label: "Create rule",
                  icon: <Zap size={12} aria-hidden="true" />,
                  onRun: (_ids: string[], rows: BulkRow[]) => {
                    const draft = draftFromSelection(rows);
                    if (!draft) return;
                    if (selectionPayees(rows).length > SELECTION_RULE_MAX_PAYEES) {
                      toast.info(`The rule lists the first ${SELECTION_RULE_MAX_PAYEES} payees`, "Select fewer payees, or split them into separate rules.");
                    }
                    drawer.openDraft(draft);
                  },
                },
              ]
            : []),
        ]
      : []),
    {
      id: "bulk-export",
      label: "Export",
      icon: <Download size={12} aria-hidden="true" />,
      keepSelection: true,
      onRun: (_ids: string[], rows: BulkRow[]) => exportRows(rows),
    },
  ];

  const count = pending?.ids.length ?? 0;

  return (
    <>
      <RecordTableBulkBar actions={actions} />
      <Modal
        open={pending?.kind === "category"}
        onClose={close}
        size="sm"
        title={`Set the category for ${pluralize(count, "transaction")}`}
        footer={
          <>
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button
              type="button"
              className="btn btn--accent"
              disabled={!category.trim()}
              onClick={() => {
                const ids = pending?.ids ?? [];
                const value = category.trim();
                finish();
                void runBulk(ids, { category: value }, (n) => `Set ${pluralize(n, "transaction")} to ${value}`);
              }}
            >
              Set category
            </button>
          </>
        }
      >
        <Field label="Category" hint="Replaces any category a rule set. Undo puts the previous ones back.">
          <input
            className="input"
            list="txn-bulk-category-options"
            value={category}
            autoFocus
            placeholder="e.g. Office & technology"
            onChange={(event) => setCategory(event.target.value)}
          />
        </Field>
        <datalist id="txn-bulk-category-options">
          {categories.map((option) => <option key={option} value={option} />)}
        </datalist>
      </Modal>
      <Modal
        open={pending?.kind === "tag"}
        onClose={close}
        size="sm"
        title={`Tag ${pluralize(count, "transaction")}`}
        footer={
          <>
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button
              type="button"
              className="btn btn--accent"
              disabled={!tagChoice}
              onClick={() => {
                const ids = pending?.ids ?? [];
                const choice = tagChoice;
                finish();
                void runAssignTag(ids, choice);
              }}
            >
              {tagChoice.startsWith(REMOVE_PREFIX) ? "Remove tag" : "Assign tag"}
            </button>
          </>
        }
      >
        <Field label="Tag" hint="Every line of a split gets the tag. A tag replaces any other tag from its group.">
          <Select
            value={tagChoice}
            onChange={setTagChoice}
            placeholder="Choose a tag"
            searchable
            options={[
              ...tags.options,
              ...tags.activeGroups.map((group) => ({ value: `${REMOVE_PREFIX}${group._id}`, label: `Remove the ${group.name} tag`, hint: group.name })),
            ]}
          />
        </Field>
      </Modal>
      <Modal
        open={pending?.kind === "fund"}
        onClose={close}
        size="sm"
        title={`Assign a fund to ${pluralize(count, "transaction")}`}
        footer={
          <>
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button
              type="button"
              className="btn btn--accent"
              disabled={!fundId}
              onClick={() => {
                const ids = pending?.ids ?? [];
                const fund = funds.find((row) => row._id === fundId);
                const value = fundId === "none" ? null : fundId;
                finish();
                void runBulk(ids, { fundRestrictionId: value }, (n) =>
                  value ? `Assigned ${pluralize(n, "transaction")} to ${fund?.name ?? "the fund"}` : `Removed the fund from ${pluralize(n, "transaction")}`,
                );
              }}
            >
              Assign fund
            </button>
          </>
        }
      >
        <Field label="Fund or restriction">
          <Select
            value={fundId}
            onChange={setFundId}
            placeholder="Choose a fund"
            options={[
              ...funds.map((fund) => ({ value: fund._id, label: fund.name, hint: fund.purpose })),
              { value: "none", label: "No fund (unrestricted)" },
            ]}
          />
        </Field>
      </Modal>
    </>
  );
}
