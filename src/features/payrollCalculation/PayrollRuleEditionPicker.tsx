import { useCallback, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { PayrollQueryBoundary } from "./payrollUi";
import {
  payrollRuleCompatibility,
  type PayrollRuleEdition,
  type PayrollRuleStatus,
} from "../../../shared/payrollRules";

type Args = { societyId: string; status?: PayrollRuleStatus; year?: number };
type Page = {
  page: PayrollRuleEdition[];
  isDone: boolean;
  continueCursor: string;
};
function RulePage({
  args,
  cursor,
  seen,
  report,
}: {
  args: Args;
  cursor: string | null;
  seen: string[];
  report: (cursor: string | null, page?: Page) => void;
}) {
  const response = useQuery(api.payrollRules.workspace, { ...args, cursor }) as
    | Page
    | undefined;
  useEffect(() => {
    report(cursor, response);
    return () => report(cursor, undefined);
  }, [cursor, report, response]);
  if (!response || response.isDone) return null;
  if (!response.continueCursor || seen.includes(response.continueCursor))
    throw new Error("The rules page did not advance. Reload the rule library.");
  return (
    <RulePage
      args={args}
      cursor={response.continueCursor}
      seen={[...seen, response.continueCursor]}
      report={report}
    />
  );
}
export function usePayrollRuleEditions(args: Args) {
  const key = JSON.stringify(args),
    [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    attempt: number;
    pages: Map<string, Page>;
    rows: PayrollRuleEdition[];
    ready: boolean;
  }>({ key: "", attempt: 0, pages: new Map(), rows: [], ready: false });
  const report = useCallback(
    (cursor: string | null, page?: Page) =>
      setState((previous) => {
        const pages =
          previous.key === key && previous.attempt === attempt
            ? new Map(previous.pages)
            : new Map<string, Page>();
        if (page) pages.set(cursor ?? "", page);
        else pages.delete(cursor ?? "");
        const rows = new Map<string, PayrollRuleEdition>(),
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
        return { key, attempt, pages, rows: [...rows.values()], ready };
      }),
    [key, attempt],
  );
  const current =
    state.key === key && state.attempt === attempt
      ? state
      : { rows: [] as PayrollRuleEdition[], ready: false };
  const loader = (
    <PayrollQueryBoundary
      key={`${key}:${attempt}`}
      label="Payroll rule editions"
      onRetry={() => setAttempt((old) => old + 1)}
    >
      <RulePage args={args} cursor={null} seen={[]} report={report} />
    </PayrollQueryBoundary>
  );
  return { ...current, loader };
}
export function PayrollRuleEditionPicker({
  societyId,
  payDate,
  method,
  value,
  onChange,
}: {
  societyId: string;
  payDate: string;
  method: "option1" | "option2";
  value?: string;
  onChange: (id?: string) => void;
}) {
  const result = usePayrollRuleEditions({
    societyId,
    status: "published",
    ...(payDate ? { year: Number(payDate.slice(0, 4)) } : {}),
  });
  const selected = useQuery(
    api.payrollRules.get,
    value ? { societyId, id: value } : "skip",
  ) as PayrollRuleEdition | undefined;
  const available = result.rows.filter(
    (row) =>
      row.rateSet.method === method &&
      payDate >= row.rateSet.effectiveFrom &&
      payDate <= row.rateSet.effectiveTo &&
      payrollRuleCompatibility(row.rateSet).supported,
  );
  return (
    <div>
      {result.loader}
      <Field
        label="Payroll rule edition"
        hint="Leave the default to use Societyer’s reviewed built-in edition for the actual payment date. An explicit workspace edition must be published, effective and compatible; its full rates, sources and review are frozen in the calculation."
      >
        <select
          className="input"
          value={value ?? ""}
          disabled={!result.ready}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">Reviewed built-in rates for payment date</option>
          {available.map((row) => (
            <option key={row._id} value={row._id}>
              {row.name} · revision {row.revision} · {row.rateSet.method}
            </option>
          ))}
          {value && !available.some((row) => row._id === value) && (
            <option value={value}>
              {selected?.name ?? "Selected edition"} — unavailable for this
              date/method
            </option>
          )}
        </select>
      </Field>
      {selected && (
        <p>
          Selected revision {selected.revision} · {selected.status} ·{" "}
          {selected.rateSet.effectiveFrom}–{selected.rateSet.effectiveTo} ·
          SHA-256 {selected.contentHash}.
        </p>
      )}
    </div>
  );
}
