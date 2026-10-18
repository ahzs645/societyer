import { Link } from "react-router-dom";
import { Tags, X } from "lucide-react";
import { Segmented } from "../../../components/primitives";
import { Select } from "../../../components/Select";
import {
  CATEGORISATION_METHOD_OPTIONS,
  type CategorisationMethod,
  type ReviewSegment,
  type TransactionFilterState,
} from "./transactionFilters";
import type { FinanceTagsApi } from "./useFinanceTags";

/**
 * The transactions tab's primary view: the To review / Reviewed queue, plus
 * filters for how a line was categorised and for a tag. They narrow the rows
 * before the table's own filters and search.
 */
export function TransactionsFilterBar({
  state,
  onChange,
  counts,
  tags,
}: {
  state: TransactionFilterState;
  onChange: (next: TransactionFilterState) => void;
  counts: Record<ReviewSegment, number>;
  tags: FinanceTagsApi;
}) {
  const tagOptions = tags.options;
  const selectedTag = state.tagId ? tags.tag(state.tagId) : undefined;
  // An archived tag in the URL still filters; show it in the picker too.
  const options = selectedTag && !tagOptions.some((option) => option.value === selectedTag._id)
    ? [...tagOptions, { value: selectedTag._id, label: `${selectedTag.name} (archived)`, hint: tags.group(selectedTag.groupId)?.name ?? "", color: tags.colorOf(selectedTag._id) }]
    : tagOptions;
  const filtered = Boolean(state.method || state.tagId);
  return (
    <div className="txn-filter-bar" role="group" aria-label="Transaction review and filters">
      <Segmented<ReviewSegment>
        value={state.review}
        onChange={(review) => onChange({ ...state, review })}
        items={[
          { id: "to_review", label: `To review · ${counts.to_review}` },
          { id: "reviewed", label: `Reviewed · ${counts.reviewed}` },
        ]}
      />
      <Select<CategorisationMethod>
        size="sm"
        aria-label="Categorisation method"
        value={state.method ?? ""}
        onChange={(method) => onChange({ ...state, method: method || undefined })}
        options={CATEGORISATION_METHOD_OPTIONS.map((option) => ({ value: option.value, label: option.label, hint: option.hint }))}
        placeholder="Any method"
        clearable
        clearLabel="Any method"
        menuMinWidth={260}
      />
      <Select
        size="sm"
        aria-label="Tag"
        value={state.tagId ?? ""}
        onChange={(tagId) => onChange({ ...state, tagId: tagId || undefined })}
        options={options}
        placeholder={tags.loaded && options.length === 0 ? "No tags yet" : "Any tag"}
        clearable
        clearLabel="Any tag"
        searchable
        disabled={options.length === 0}
        menuMinWidth={240}
      />
      {filtered && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ review: state.review })}>
          <X size={12} aria-hidden="true" /> Clear filters
        </button>
      )}
      <Link className="btn btn--ghost btn--sm txn-filter-bar__manage" to="/app/financials/tags">
        <Tags size={12} aria-hidden="true" /> Manage tags
      </Link>
    </div>
  );
}
