import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * One closed fold for the minutes' supporting records: decisions and
 * evidence, meeting history and the people named in the minutes. They are
 * for review and audit, so they sit below the minutes instead of adding
 * several cards (most of them empty) to the tab.
 */
export function MeetingRecordsFold({ count, children }: { count: number; children: ReactNode }) {
  return (
    <details className="card meeting-records-fold" data-testid="meeting-records-fold">
      <summary className="card__head">
        <ChevronRight size={14} aria-hidden="true" className="meeting-records-fold__chevron" />
        <h2 className="card__title">Records &amp; evidence</h2>
        <span className="card__subtitle">
          {count > 0 ? `${count.toLocaleString()} recorded` : "Decisions, history and people"}
        </span>
      </summary>
      <div className="meeting-records-fold__body">{children}</div>
    </details>
  );
}
