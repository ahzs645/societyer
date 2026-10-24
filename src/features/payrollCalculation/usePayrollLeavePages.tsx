import { useCallback, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type {
  PayrollVacationPeriodRecord,
  PayrollVacationRequestRecord,
  PayrollVacationWorkspace,
} from "../../../shared/payrollLeave";
import { PayrollQueryBoundary } from "./payrollUi";
export type PayrollLeavePageArgs = {
  societyId: string;
  employeeId: string;
  collection: "periods" | "requests";
  periodId?: string;
};
type LeaveRecord = PayrollVacationPeriodRecord | PayrollVacationRequestRecord;
function LeavePage({
  args,
  cursor,
  seen,
  report,
}: {
  args: PayrollLeavePageArgs;
  cursor: string | null;
  seen: string[];
  report: (
    cursor: string | null,
    value: PayrollVacationWorkspace | undefined,
  ) => void;
}) {
  const value = useQuery(api.payrollLeave.workspace, { ...args, cursor }) as
    | PayrollVacationWorkspace
    | undefined;
  useEffect(() => report(cursor, value), [cursor, report, value]);
  if (!value || value.isDone) return null;
  if (!value.continueCursor || seen.includes(value.continueCursor))
    throw new Error(
      "Vacation pagination did not advance. Reload the complete records before proceeding.",
    );
  return (
    <LeavePage
      args={args}
      cursor={value.continueCursor}
      seen={[...seen, value.continueCursor]}
      report={report}
    />
  );
}
export function usePayrollLeavePages<T extends LeaveRecord>(
  args: PayrollLeavePageArgs | undefined,
  label: string,
) {
  const key = JSON.stringify(args ?? null),
    [attempt, setAttempt] = useState(0),
    [state, setState] = useState<{
      key: string;
      attempt: number;
      pages: Map<string, PayrollVacationWorkspace>;
      rows: T[];
      ready: boolean;
      error: string;
      metadata?: PayrollVacationWorkspace;
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
    (cursor: string | null, value: PayrollVacationWorkspace | undefined) =>
      setState((old) => {
        const pages =
          old.key === key && old.attempt === attempt
            ? new Map(old.pages)
            : new Map<string, PayrollVacationWorkspace>();
        if (value) pages.set(cursor ?? "", value);
        else pages.delete(cursor ?? "");
        const rows = new Map<string, T>(),
          seen = new Set<string>();
        let next = "",
          ready = false;
        while (pages.has(next) && !seen.has(next)) {
          seen.add(next);
          const page = pages.get(next)!;
          for (const row of page.page) rows.set(row._id, row as T);
          if (page.isDone) {
            ready = true;
            break;
          }
          next = page.continueCursor;
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
  const fail = useCallback(
    (error: string) =>
      setState((old) => ({ ...old, key, attempt, ready: false, error })),
    [attempt, key],
  );
  const loader = args ? (
    <PayrollQueryBoundary
      key={`${key}:${attempt}`}
      label={label}
      onRetry={retry}
      onError={fail}
    >
      <LeavePage args={args} cursor={null} seen={[]} report={report} />
    </PayrollQueryBoundary>
  ) : null;
  const current =
    state.key === key && state.attempt === attempt
      ? state
      : { rows: [] as T[], ready: !args, error: "", metadata: undefined };
  return { ...current, loader, retry };
}
