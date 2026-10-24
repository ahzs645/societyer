import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";

export type PlanningCollection = "costs" | "staff" | "insurance" | "subscriptions" | "budgets" | "actuals";
type Page<T> = { page: T[]; isDone: boolean; continueCursor: string; [key: string]: unknown };
type Arguments = { societyId: string; collection: PlanningCollection; periodId?: string; asOf?: string };
type Data<T> = { rows: T[]; ready: boolean; error: string; page?: Page<T> };

export class PlanningQueryBoundary extends Component<{ children: ReactNode; label: string; onRetry: () => void; onError?: (message: string) => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { this.props.onError?.(error.message); }
  render() {
    if (this.state.error) return <div className="cost-planner__error" role="alert"><strong>{this.props.label}</strong><p>{this.state.error.message}</p><button type="button" className="btn btn--sm" onClick={this.props.onRetry}>Retry {this.props.label.toLowerCase()}</button></div>;
    return this.props.children;
  }
}

function PlanningSourcePage<T extends { _id: string }>({ args, cursor, seen, onPage }: { args: Arguments; cursor: string | null; seen: string[]; onPage: (cursor: string | null, page: Page<T> | undefined) => void }) {
  const page = useQuery(api.costPlanning.sourcePage, { ...args, cursor }) as Page<T> | undefined;
  useEffect(() => { onPage(cursor, page); }, [cursor, onPage, page]);
  if (!page || page.isDone) return null;
  if (!page.continueCursor || seen.includes(page.continueCursor)) throw new Error("Planning pagination did not advance. Retry loading this source.");
  return <PlanningSourcePage args={args} cursor={page.continueCursor} seen={[...seen, page.continueCursor]} onPage={onPage} />;
}

/** Every page remains a reactive subscription; complete totals never use a truncated prefix. */
export function usePlanningCollection<T extends { _id: string }>(args: Arguments | undefined, label: string) {
  const key = JSON.stringify(args ?? null), [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; attempt: number; pages: Map<string, Page<T>>; data: Data<T> }>({ key: "", attempt: 0, pages: new Map(), data: { rows: [], ready: false, error: "" } });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const onPage = useCallback((cursor: string | null, page: Page<T> | undefined) => {
    setState((previous) => {
      const pages = previous.key === key && previous.attempt === attempt ? new Map(previous.pages) : new Map<string, Page<T>>();
      if (!page) { pages.delete(cursor ?? ""); return { key, attempt, pages, data: { rows: [], ready: false, error: "" } }; }
      pages.set(cursor ?? "", page);
      const rows = new Map<string, T>(), active = new Set<string>(); let current = "", complete = false, last: Page<T> | undefined;
      while (pages.has(current) && !active.has(current)) {
        active.add(current); last = pages.get(current)!;
        for (const row of last.page) rows.set(row._id, row);
        if (last.isDone) { complete = true; break; }
        current = last.continueCursor;
      }
      return { key, attempt, pages, data: { rows: [...rows.values()], ready: complete, error: "", page: last } };
    });
  }, [attempt, key]);
  const onError = useCallback((error: string) => setState((previous) => ({ ...previous, key, attempt, data: { rows: [], ready: false, error } })), [attempt, key]);
  const loader = useMemo(() => args ? <PlanningQueryBoundary key={`${key}:${attempt}`} label={label} onRetry={retry} onError={onError}><PlanningSourcePage<T> args={args} cursor={null} seen={[]} onPage={onPage} /></PlanningQueryBoundary> : null, [args, attempt, key, label, onError, onPage, retry]);
  const data = !args ? { rows: [] as T[], ready: true, error: "" } : state.key === key && state.attempt === attempt ? state.data : { rows: [] as T[], ready: false, error: "" };
  return { ...data, loader, retry };
}
