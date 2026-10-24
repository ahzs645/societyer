import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { parseMoneyInput } from "../../lib/money";
import type { PayrollCalculationWorkspace } from "../../../shared/payrollCalculation";

export type PayrollRow<T = Record<string, unknown>> = T & {
  _id: string;
  employeeId?: string;
  fields?: T;
  name?: string;
  employeeName?: string;
  updatedAtISO?: string;
};
export const payrollFields = <T,>(row?: PayrollRow<T> | null): T | undefined =>
  row ? ((row.fields ?? row) as T) : undefined;
export const amountInput = (value?: number) =>
  value === undefined ? "" : (value / 100).toFixed(2);
export function payrollMoney(
  value: string,
  label: string,
  optional = false,
): number | undefined {
  if (optional && !value.trim()) return undefined;
  const parsed = parseMoneyInput(value);
  if (parsed === undefined || !Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(
      `${label}: enter a nonnegative amount with at most two decimal places.`,
    );
  return parsed;
}
export function payrollNumber(
  value: string,
  label: string,
  optional = false,
): number | undefined {
  if (optional && !value.trim()) return undefined;
  const parsed = Number(value);
  if (!value.trim() || !Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${label}: enter a nonnegative number.`);
  return parsed;
}
export const payrollFailure = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The payroll operation failed.";
export function PayrollMoneyField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="input"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
export function PayrollFormActions({
  busy,
  onCancel,
  label = "Save",
}: {
  busy: boolean;
  onCancel: () => void;
  label?: string;
}) {
  return (
    <div className="payroll-calculator__actions">
      <button type="button" className="btn" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <button className="btn btn--accent" disabled={busy}>
        {busy ? "Saving…" : label}
      </button>
    </div>
  );
}

export class PayrollQueryBoundary extends Component<
  {
    children: ReactNode;
    label: string;
    onRetry: () => void;
    onError?: (message: string) => void;
  },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error.message);
  }
  render() {
    return this.state.error ? (
      <div className="payroll-calculator__blockers" role="alert">
        <strong>{this.props.label}</strong>
        <p>{this.state.error.message}</p>
        <button
          type="button"
          className="btn btn--sm"
          onClick={this.props.onRetry}
        >
          Retry {this.props.label.toLowerCase()}
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export type PayrollPageArgs = {
  societyId: string;
  collection: string;
  employeeId?: string;
  year?: number;
  from?: string;
  to?: string;
};
type Page<T> = Omit<PayrollCalculationWorkspace, "page"> & { page: T[] };
function PayrollSourcePage<T extends { _id: string }>({
  args,
  cursor,
  seen,
  report,
}: {
  args: PayrollPageArgs;
  cursor: string | null;
  seen: string[];
  report: (cursor: string | null, page: Page<T> | undefined) => void;
}) {
  const response = useQuery(api.payrollCalculation.workspace, {
    ...args,
    cursor,
  }) as Page<T> | undefined;
  useEffect(() => {
    report(cursor, response);
  }, [cursor, report, response]);
  if (!response || response.isDone) return null;
  if (!response.continueCursor || seen.includes(response.continueCursor))
    throw new Error(
      "Payroll pagination did not advance. Retry loading records.",
    );
  return (
    <PayrollSourcePage
      args={args}
      cursor={response.continueCursor}
      seen={[...seen, response.continueCursor]}
      report={report}
    />
  );
}
/** Complete reactive lists are used for source pickers; none of these pages approximates YTD totals. */
export function usePayrollPages<T extends { _id: string }>(
  args: PayrollPageArgs | undefined,
  label: string,
) {
  const key = JSON.stringify(args ?? null),
    [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    attempt: number;
    pages: Map<string, Page<T>>;
    rows: T[];
    ready: boolean;
    error: string;
    metadata?: Page<T>;
  }>({
    key: "",
    attempt: 0,
    pages: new Map(),
    rows: [],
    ready: false,
    error: "",
  });
  const retry = useCallback(() => setAttempt((old) => old + 1), []);
  const report = useCallback(
    (cursor: string | null, page: Page<T> | undefined) =>
      setState((previous) => {
        const pages =
          previous.key === key && previous.attempt === attempt
            ? new Map(previous.pages)
            : new Map<string, Page<T>>();
        if (page) pages.set(cursor ?? "", page);
        else pages.delete(cursor ?? "");
        const rows = new Map<string, T>(),
          seen = new Set<string>();
        let next = "",
          ready = false;
        while (pages.has(next) && !seen.has(next)) {
          seen.add(next);
          const current = pages.get(next)!;
          for (const row of current.page) rows.set(row._id, row);
          if (current.isDone) {
            ready = true;
            break;
          }
          next = current.continueCursor;
        }
        return {
          key,
          attempt,
          pages,
          rows: [...rows.values()],
          ready,
          error: "",
          metadata: pages.get(""),
        };
      }),
    [attempt, key],
  );
  const onError = useCallback(
    (error: string) =>
      setState({
        key,
        attempt,
        pages: new Map(),
        rows: [],
        ready: false,
        error,
        metadata: undefined,
      }),
    [attempt, key],
  );
  const loader = useMemo(
    () =>
      args ? (
        <PayrollQueryBoundary
          key={`${key}:${attempt}`}
          label={label}
          onRetry={retry}
          onError={onError}
        >
          <PayrollSourcePage
            args={args}
            cursor={null}
            seen={[]}
            report={report}
          />
        </PayrollQueryBoundary>
      ) : null,
    [args, attempt, key, label, onError, report, retry],
  );
  const current =
    state.key === key && state.attempt === attempt
      ? state
      : { rows: [] as T[], ready: !args, error: "", metadata: undefined };
  return { ...current, loader, retry };
}
