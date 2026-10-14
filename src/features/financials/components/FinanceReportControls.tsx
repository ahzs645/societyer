import type { ReactNode } from "react";
import type { FundFilter } from "../lib/ledgerReports";

/** Restricted-fund filter chips: All · Unrestricted · each fund with posted activity. */
export function FundFilterChips({
  funds,
  value,
  onChange,
  showUnrestricted = true,
}: {
  funds: Array<{ _id: string; name: string }>;
  value: FundFilter;
  onChange: (value: FundFilter) => void;
  showUnrestricted?: boolean;
}) {
  if (funds.length === 0) return null;
  const options: Array<{ id: FundFilter; label: string }> = [
    { id: "all", label: "All funds" },
    ...(showUnrestricted ? [{ id: "unrestricted" as FundFilter, label: "Unrestricted" }] : []),
    ...funds.map((fund) => ({ id: String(fund._id) as FundFilter, label: fund.name })),
  ];
  return (
    <div className="finance-chips" role="group" aria-label="Filter by fund">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`finance-chip${value === option.id ? " is-active" : ""}`}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Compact labelled control slot for report toolbars. */
export function ReportControl({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="finance-report-control">
      <span className="finance-report-control__label">{label}</span>
      {children}
    </label>
  );
}

/** Pill toggle for "Compare with prior year". */
export function CompareToggle({ checked, onChange, label = "Compare with prior year", disabled }: { checked: boolean; onChange: (next: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`finance-chip${checked ? " is-active" : ""}`}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      {label}
    </button>
  );
}
