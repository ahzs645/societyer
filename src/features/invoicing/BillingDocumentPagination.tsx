import { useState } from "react";

export function useBillingDocumentPagination(scope: string) {
  const first = { scope, cursors: [null] as Array<string | null>, index: 0 };
  const [saved, setSaved] = useState(first);
  const current = saved.scope === scope ? saved : first;
  return {
    cursor: current.cursors[current.index], page: current.index + 1,
    reset: () => setSaved(first),
    previous: () => setSaved({ ...current, index: Math.max(0, current.index - 1) }),
    next: (cursor: string) => setSaved({ ...current, cursors: [...current.cursors.slice(0, current.index + 1), cursor], index: current.index + 1 }),
  };
}

type Props = { label: string; pagination: ReturnType<typeof useBillingDocumentPagination>; result?: { isDone: boolean; continueCursor: string } };
export function BillingDocumentPagination({ label, pagination, result }: Props) {
  return <nav className="invoice-commerce-actions" aria-label={`${label} pagination`}>
    <button className="btn btn--sm" aria-label={`Previous ${label} page`} disabled={pagination.page === 1 || !result} onClick={pagination.previous}>Previous</button>
    <span className="muted">Page {pagination.page}</span>
    <button className="btn btn--sm" aria-label={`Next ${label} page`} disabled={!result || result.isDone} onClick={() => result && pagination.next(result.continueCursor)}>Next</button>
  </nav>;
}
