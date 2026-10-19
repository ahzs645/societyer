import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, X } from "lucide-react";
import { DatePicker } from "../../../components/DatePicker";
import { InfoPopover } from "../../../components/InfoPopover";
import { Menu, type MenuSection } from "../../../components/Menu";
import { Segmented } from "../../../components/primitives";
import { Select, type SelectOption } from "../../../components/Select";
import { FundFilterChips, ReportControl } from "../components/FinanceReportControls";
import type { AccountingBasis, ReportFrequency } from "../../../../shared/booksReports";
import { BASIS_LABELS, FREQUENCY_LABELS, type ReportFilterState } from "./reportFilters";
import { PRESET_LABELS, type DateRange, type RangePreset } from "./reportPeriods";
import type { ReportStateActions } from "./useReportState";
import type { FundOption } from "./types";
import type { FinanceTagsApi } from "../transactions/useFinanceTags";

const ALL = "__all";

/** Wrapping row of report controls; each child keeps its own size and wraps as a whole. */
export function ReportToolbar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="books-report-toolbar" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** Range preset picker, plus From / To date pickers for a custom range. */
export function PeriodControl({
  presets,
  preset,
  range,
  onPreset,
  onRange,
}: {
  presets: readonly RangePreset[];
  preset: RangePreset;
  range: DateRange;
  onPreset: (preset: RangePreset) => void;
  onRange: (range: DateRange) => void;
}) {
  // A preset this toolbar doesn't list (carried over from another report) shows as Custom.
  const shown: RangePreset = presets.includes(preset) ? preset : "custom";
  const options: SelectOption<RangePreset>[] = presets.map((id) => ({ value: id, label: PRESET_LABELS[id] }));
  return (
    <div className="books-report-toolbar__group">
      <ReportControl label="Period">
        <Select<RangePreset> size="sm" value={shown} onChange={onPreset} options={options} />
      </ReportControl>
      {shown === "custom" && (
        <>
          <ReportControl label="From">
            <DatePicker size="sm" clearable={false} value={range.from} max={range.to || undefined} onChange={(from) => onRange({ from, to: range.to })} />
          </ReportControl>
          <ReportControl label="To">
            <DatePicker size="sm" clearable={false} value={range.to} min={range.from || undefined} onChange={(to) => onRange({ from: range.from, to })} />
          </ReportControl>
        </>
      )}
    </div>
  );
}

/** Monthly / Quarterly / Yearly columns. */
export function FrequencyControl({ value, onChange }: { value: ReportFrequency; onChange: (value: ReportFrequency) => void }) {
  const items = (Object.keys(FREQUENCY_LABELS) as ReportFrequency[]).map((id) => ({ id, label: FREQUENCY_LABELS[id] }));
  return (
    <div className="books-report-toolbar__group" role="group" aria-label="Columns">
      <Segmented<ReportFrequency> value={value} onChange={onChange} items={items} />
    </div>
  );
}

/** Accrual / Cash, with the books' default marked and a note on what each means. */
export function BasisControl({ basis, defaultBasis, onChange }: { basis: AccountingBasis; defaultBasis: AccountingBasis; onChange: (basis: AccountingBasis) => void }) {
  const items = (Object.keys(BASIS_LABELS) as AccountingBasis[]).map((id) => ({
    id,
    label: id === defaultBasis ? `${BASIS_LABELS[id]} (default)` : BASIS_LABELS[id],
  }));
  return (
    <div className="books-report-toolbar__group" role="group" aria-label="Accounting basis">
      <span className="finance-report-control__label">Basis</span>
      <Segmented<AccountingBasis> value={basis} onChange={onChange} items={items} />
      <InfoPopover label="About the accounting basis">
        <p>
          <strong>Accrual</strong> records revenue when an invoice is issued and expenses when a bill arrives, with
          receivables and payables in between.
        </p>
        <p>
          <strong>Cash</strong> records them on the day the money moves, so invoices and bills only count once they
          are paid.
        </p>
        <p>
          Your books default to {BASIS_LABELS[defaultBasis].toLowerCase()}. Change the default in{" "}
          <Link to="/app/financials/books-settings">Books settings</Link>.
        </p>
      </InfoPopover>
    </div>
  );
}

/** Program filter: All programs or one program code with posted revenue or expenses. */
export function ProgramControl({ programs, value, onChange }: { programs: string[]; value: string | null; onChange: (value: string | null) => void }) {
  if (!programs.length && !value) return null;
  const list = value && !programs.includes(value) ? [...programs, value] : programs;
  const options: SelectOption[] = [{ value: ALL, label: "All programs" }, ...list.map((code) => ({ value: code, label: code }))];
  return (
    <ReportControl label="Program">
      <Select size="sm" value={value ?? ALL} onChange={(next) => onChange(next === ALL ? null : next)} options={options} />
    </ReportControl>
  );
}

/**
 * Tag filter: tags listed under their group (the workspace's tag groups);
 * picking one toggles it. Lines match any chosen tag of a group and every
 * group chosen (see toReportFilter). Archived tags stay pickable once chosen
 * so a shared link keeps working. Hidden when the workspace has no tags.
 */
export function TagControl({ tags, value, onChange }: { tags: FinanceTagsApi; value: string[]; onChange: (next: string[]) => void }) {
  const chosen = new Set(value);
  const sections: MenuSection[] = tags.groups
    .map((group) => ({
      id: group._id,
      label: group.name,
      items: group.tags
        .filter((tag) => (!tag.archived && !group.archived) || chosen.has(tag._id))
        .map((tag) => ({
          id: tag._id,
          label: tag.archived ? `${tag.name} (archived)` : tag.name,
          icon: chosen.has(tag._id) ? <Check size={12} aria-hidden="true" /> : <span className={`txn-tags__dot txn-tags__dot--${tags.colorOf(tag._id)}`} aria-hidden="true" />,
          onSelect: () => onChange(chosen.has(tag._id) ? value.filter((id) => id !== tag._id) : [...value, tag._id]),
        })),
    }))
    .filter((section) => section.items.length > 0);
  if (!sections.length && !value.length) return null;
  const names = value.map((id) => tags.tagName(id) ?? "Removed tag");
  const summary = names.length === 0 ? "All tags" : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
  const menuSections: MenuSection[] = value.length
    ? [{ id: "clear", items: [{ id: "clear", label: "All tags", icon: <X size={12} aria-hidden="true" />, onSelect: () => onChange([]) }] }, ...sections]
    : sections;
  return (
    <div className="books-report-toolbar__group">
      <span className="finance-report-control__label" id="books-report-tags-label">Tags</span>
      <Menu
        label="Tag filter"
        sheetTitle="Filter by tag"
        minWidth={220}
        sections={menuSections}
        trigger={
          <button type="button" className="btn btn--sm books-report-toolbar__tags" aria-labelledby="books-report-tags-label books-report-tags-value" title={names.join(", ") || undefined}>
            <span id="books-report-tags-value">{summary}</span> <ChevronDown size={12} aria-hidden="true" />
          </button>
        }
      />
    </div>
  );
}

/** Currency picker, shown only when the books hold more than one currency. */
export function CurrencyControl({ currencies, value, onChange }: { currencies: string[]; value: string; onChange: (value: string) => void }) {
  if (currencies.length <= 1) return null;
  return (
    <ReportControl label="Currency">
      <Select size="sm" value={value} onChange={onChange} options={currencies.map((code) => ({ value: code, label: code }))} />
    </ReportControl>
  );
}

/** Basis, program, tag, currency and fund filters, shared by every report. */
export function ReportFilterControls({
  basis,
  defaultBasis,
  filter,
  funds,
  tags,
  programs,
  currencies,
  currency,
  actions,
  children,
}: {
  basis: AccountingBasis;
  defaultBasis: AccountingBasis;
  filter: ReportFilterState;
  funds: FundOption[];
  tags: FinanceTagsApi;
  programs: string[];
  currencies: string[];
  currency: string;
  actions: ReportStateActions;
  /** Extra controls placed before the basis (the ledger account picker). */
  children?: ReactNode;
}) {
  return (
    <ReportToolbar label="Report filters">
      {children}
      <BasisControl basis={basis} defaultBasis={defaultBasis} onChange={actions.setBasis} />
      <ProgramControl programs={programs} value={filter.dimensions.programCode?.[0] ?? null} onChange={(value) => actions.setDimension("programCode", value)} />
      <TagControl tags={tags} value={filter.dimensions.tag ?? []} onChange={(value) => actions.setDimension("tag", value)} />
      <CurrencyControl currencies={currencies} value={currency} onChange={actions.setCurrency} />
      <FundFilterChips funds={funds} value={filter.fund} onChange={actions.setFund} />
    </ReportToolbar>
  );
}
