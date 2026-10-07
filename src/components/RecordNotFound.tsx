import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, SearchX } from "lucide-react";
import { PageHeader } from "../pages/_helpers";
import { EmptyState } from "./ui";

/**
 * Not-found state for record detail routes (`/app/<area>/:id`).
 *
 * Detail queries return `null` for missing, deleted and foreign-workspace ids
 * (see shared/functions/recordLookup.ts). Render this instead of leaving the
 * page on "Loading…": it keeps a page heading for screen readers, says what
 * was not found, and links back to the list.
 */
export function RecordNotFound({
  recordLabel,
  backTo,
  backLabel,
  icon,
  description,
  action,
  embedded = false,
}: {
  /** Human noun, e.g. "Grant", "Asset", "Workflow". */
  recordLabel: string;
  /** List route to return to, e.g. "/app/grants". */
  backTo: string;
  /** Link text, e.g. "All grants". */
  backLabel: string;
  icon?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Render without the outer `.page` wrapper (inside an existing page). */
  embedded?: boolean;
}) {
  const body = (
    <>
      <Link to={backTo} className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> {backLabel}
      </Link>
      <PageHeader title={`${recordLabel} not found`} icon={icon} />
      <div role="status" data-testid="record-not-found">
        <EmptyState
          icon={<SearchX size={20} />}
          title={`This ${recordLabel.toLowerCase()} doesn't exist in this workspace`}
          description={
            description ??
            "It may have been deleted, or the link points to a record in another workspace. Check the address or return to the list."
          }
          action={action ?? <Link className="btn btn--accent" to={backTo}>{backLabel}</Link>}
        />
      </div>
    </>
  );
  return embedded ? body : <div className="page">{body}</div>;
}
