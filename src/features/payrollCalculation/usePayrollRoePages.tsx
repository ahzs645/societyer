import { useCallback, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type {
  RoeWorkflowWorkspace,
  RoeWorkflowView,
  RoeRegister,
} from "../../../shared/payrollRoeWorkflow";
import { PayrollQueryBoundary } from "./payrollUi";
type Args = {
  societyId: string;
  collection: "cases" | "registers";
  employeeId?: string;
};
function Page({
  args,
  cursor,
  seen,
  report,
}: {
  args: Args;
  cursor: string | null;
  seen: string[];
  report: (
    cursor: string | null,
    result: RoeWorkflowWorkspace | undefined,
  ) => void;
}) {
  const value = useQuery(api.payrollRoeWorkflow.workspace, {
    ...args,
    cursor,
  }) as RoeWorkflowWorkspace | undefined;
  useEffect(() => report(cursor, value), [cursor, report, value]);
  if (!value || value.isDone) return null;
  if (!value.continueCursor || seen.includes(value.continueCursor))
    throw new Error(
      "ROE case pagination did not advance. Restart the complete source read.",
    );
  return (
    <Page
      args={args}
      cursor={value.continueCursor}
      seen={[...seen, value.continueCursor]}
      report={report}
    />
  );
}
export function usePayrollRoePages<T extends RoeWorkflowView | RoeRegister>(
  args: Args | undefined,
) {
  const key = JSON.stringify(args ?? null),
    [attempt, setAttempt] = useState(0),
    [state, setState] = useState<{
      key: string;
      pages: Map<string, RoeWorkflowWorkspace>;
      rows: T[];
      ready: boolean;
      error: string;
    }>({ key: "", pages: new Map(), rows: [], ready: false, error: "" });
  const report = useCallback(
    (cursor: string | null, value: RoeWorkflowWorkspace | undefined) =>
      setState((old) => {
        const pages =
          old.key === key
            ? new Map(old.pages)
            : new Map<string, RoeWorkflowWorkspace>();
        if (value) pages.set(cursor ?? "", value);
        else pages.delete(cursor ?? "");
        const rows = new Map<string, T>(),
          seen = new Set<string>();
        let next = "",
          ready = false;
        while (pages.has(next) && !seen.has(next)) {
          seen.add(next);
          const page = pages.get(next)!;
          page.page.forEach((row) => rows.set(row._id, row as T));
          if (page.isDone) {
            ready = true;
            break;
          }
          next = page.continueCursor;
        }
        return { key, pages, rows: [...rows.values()], ready, error: "" };
      }),
    [key],
  );
  const retry = useCallback(() => {
      setState({
        key: "",
        pages: new Map(),
        rows: [],
        ready: false,
        error: "",
      });
      setAttempt((old) => old + 1);
    }, []),
    fail = useCallback(
      (error: string) =>
        setState((old) => ({ ...old, key, ready: false, error })),
      [key],
    );
  return {
    rows: state.key === key ? state.rows : [],
    ready: state.key === key && state.ready,
    error: state.key === key ? state.error : "",
    today: state.pages.get("")?.today ?? new Date().toISOString().slice(0, 10),
    loader: args ? (
      <PayrollQueryBoundary
        key={`${key}:${attempt}`}
        label="ROE workflow source pages"
        onRetry={retry}
        onError={fail}
      >
        <Page args={args} cursor={null} seen={[]} report={report} />
      </PayrollQueryBoundary>
    ) : null,
  };
}
