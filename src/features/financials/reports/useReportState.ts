import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { AccountingBasis, ReportFrequency } from "../../../../shared/booksReports";
import { todayDateOnly } from "../../../../shared/dateOnly";
import { DIMENSION_PARAMS, dimensionParamValue, isBasis, isFrequency, readFilterState, type DimensionKind, type ReportFilterState } from "./reportFilters";
import { isRangePreset, presetRange, type DateRange, type RangePreset } from "./reportPeriods";

export type ReportFamily = "statement" | "ledger";

const DEFAULT_PRESET: Record<ReportFamily, Exclude<RangePreset, "custom">> = { statement: "this-fy", ledger: "this-month" };

export type ReportState = {
  today: string;
  preset: RangePreset;
  range: DateRange;
  frequency: ReportFrequency;
  /** The basis the report is prepared on: the URL override, else the books' default. */
  basis: AccountingBasis;
  defaultBasis: AccountingBasis;
  filter: ReportFilterState;
  currency: string | null;
  accountId: string | null;
};

export type ReportStateActions = {
  setPreset: (preset: RangePreset) => void;
  setRange: (range: DateRange) => void;
  setFrequency: (frequency: ReportFrequency) => void;
  setBasis: (basis: AccountingBasis) => void;
  setFund: (fund: string) => void;
  /** One value (program) or several (tags); null or [] clears the dimension. */
  setDimension: (kind: DimensionKind, value: string | readonly string[] | null) => void;
  /** Back to all funds and no dimension filters, in one URL update. */
  clearFilters: () => void;
  setCurrency: (currency: string | null) => void;
  setAccount: (accountId: string | null) => void;
};

/**
 * Toolbar state for the financial reports, read from and written to the URL.
 * A preset resolves against today and the fiscal year; any explicit `from` /
 * `to` with `preset=custom` (or no preset) wins.
 */
export function useReportState(family: ReportFamily, fiscalStartMonth: number, defaultBasis: AccountingBasis): [ReportState, ReportStateActions] {
  const [params, setParams] = useSearchParams();
  const today = todayDateOnly();

  const state = useMemo<ReportState>(() => {
    const rawPreset = params.get("preset");
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    const explicit = (rawPreset === "custom" || !rawPreset) && Boolean(from || to);
    const preset: RangePreset = explicit ? "custom" : isRangePreset(rawPreset) && rawPreset !== "custom" ? rawPreset : DEFAULT_PRESET[family];
    const range = preset === "custom" ? { from, to } : presetRange(preset, today, fiscalStartMonth);
    const rawFrequency = params.get("freq");
    const rawBasis = params.get("basis");
    return {
      today,
      preset,
      range,
      frequency: isFrequency(rawFrequency) ? rawFrequency : "month",
      basis: isBasis(rawBasis) ? rawBasis : defaultBasis,
      defaultBasis,
      filter: readFilterState(params),
      currency: params.get("currency") || null,
      accountId: params.get("account") || null,
    };
  }, [defaultBasis, family, fiscalStartMonth, params, today]);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value == null || value === "") next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const actions = useMemo<ReportStateActions>(
    () => ({
      setPreset: (preset) =>
        preset === "custom"
          ? update({ preset: "custom", from: state.range.from, to: state.range.to })
          : update({ preset, from: null, to: null }),
      setRange: (range) => update({ preset: "custom", from: range.from, to: range.to }),
      setFrequency: (frequency) => update({ freq: frequency === "month" ? null : frequency }),
      setBasis: (basis) => update({ basis: basis === defaultBasis ? null : basis }),
      setFund: (fund) => update({ fund: fund === "all" ? null : fund }),
      setDimension: (kind, value) => update({ [DIMENSION_PARAMS[kind]]: dimensionParamValue(kind, typeof value === "string" ? [value] : value) }),
      clearFilters: () => {
        const patch: Record<string, null> = { fund: null };
        for (const param of Object.values(DIMENSION_PARAMS)) patch[param] = null;
        update(patch);
      },
      setCurrency: (currency) => update({ currency }),
      setAccount: (accountId) => update({ account: accountId }),
    }),
    [defaultBasis, state.range.from, state.range.to, update],
  );

  return [state, actions];
}
