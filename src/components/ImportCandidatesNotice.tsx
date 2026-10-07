import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { FileSearch } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";

/**
 * "N candidates awaiting review" on the page imported records will land on
 * (finding D-19): a register that looks empty while transposed records or
 * source documents for it exist says so, and links to the review queue and
 * to the matching documents.
 *
 *   <ImportCandidatesNotice noun="policy" targets={["policies"]} kinds={["policy"]} documentCategory="Policy" />
 */
export function ImportCandidatesNotice({
  noun,
  targets = [],
  kinds = [],
  documentCategory,
  emptyRegister = true,
}: {
  /** Singular noun for the records ("policy", "financial statement"). */
  noun: string;
  /** Import target modules that feed this page. */
  targets?: string[];
  /** Import record kinds that feed this page. */
  kinds?: string[];
  /** Documents category holding the source files for this page. */
  documentCategory?: string;
  /** The page's own register is empty; then a documents-only hint is shown too. */
  emptyRegister?: boolean;
}) {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const pending = useQuery(api.importSessions.pendingByTarget, society && loaded && can("settings:read") ? { societyId: society._id } : "skip");
  const categoryCounts = useQuery(api.documents.categoryCounts, society && documentCategory && loaded && can("documents:read") ? { societyId: society._id } : "skip");
  const byTarget: Record<string, number> = pending?.byTarget ?? {};
  const byKind: Record<string, number> = pending?.byKind ?? {};
  const targetMatches = Object.entries(byTarget).filter(([target]) => targets.some((wanted) => target.toLowerCase() === wanted.toLowerCase()));
  const kindMatches = Object.entries(byKind).filter(([kind]) => kinds.includes(kind));
  // Prefer the larger signal; both describe the same pending records.
  const byTargetCount = targetMatches.reduce((sum, [, count]) => sum + count, 0);
  const byKindCount = kindMatches.reduce((sum, [, count]) => sum + count, 0);
  const candidates = Math.max(byTargetCount, byKindCount);
  const queueLink = byTargetCount >= byKindCount && targetMatches.length === 1
    ? `/app/imports?target=${encodeURIComponent(targetMatches[0][0])}`
    : kindMatches.length === 1
      ? `/app/imports?kind=${encodeURIComponent(kindMatches[0][0])}`
      : "/app/imports";
  const docs = documentCategory ? Number(categoryCounts?.[documentCategory] ?? 0) : 0;
  const approvedTarget = Object.entries((pending?.approvedByTarget ?? {}) as Record<string, number>).filter(([target]) => targets.some((wanted) => target.toLowerCase() === wanted.toLowerCase()));
  const approvedKind = Object.entries((pending?.approvedByKind ?? {}) as Record<string, number>).filter(([kind]) => kinds.includes(kind));
  const approvedTargetCount = approvedTarget.reduce((sum, [, count]) => sum + count, 0);
  const approvedKindCount = approvedKind.reduce((sum, [, count]) => sum + count, 0);
  const approved = Math.max(approvedTargetCount, approvedKindCount);
  const approvedLink = approvedTargetCount >= approvedKindCount && approvedTarget.length === 1
    ? `/app/imports?status=Approved&target=${encodeURIComponent(approvedTarget[0][0])}`
    : approvedKind.length === 1 ? `/app/imports?status=Approved&kind=${encodeURIComponent(approvedKind[0][0])}` : "/app/imports?status=Approved";
  if (!candidates && !(approved && emptyRegister) && (!docs || !emptyRegister)) return null;
  return (
    <div className="import-candidates-notice" role="status">
      <FileSearch size={14} aria-hidden="true" />
      <span>
        {candidates > 0 && (
          <>
            <strong>{candidates.toLocaleString()} {noun} candidate{candidates === 1 ? "" : "s"}</strong> from imports {candidates === 1 ? "is" : "are"} awaiting review.{" "}
            <Link to={queueLink}>Review in the import queue</Link>
            {docs > 0 ? " · " : null}
          </>
        )}
        {approved > 0 && emptyRegister && (
          <>
            <strong>{approved.toLocaleString()} approved {noun} candidate{approved === 1 ? "" : "s"}</strong> {approved === 1 ? "has" : "have"} not been applied yet.{" "}
            <Link to={approvedLink}>Find them in the import queue</Link> and run “Apply sections” on their session.
            {docs > 0 ? " · " : null}
          </>
        )}
        {docs > 0 && documentCategory && (
          <>
            {candidates === 0 && approved === 0 && <>Nothing is recorded here yet, but source files exist: </>}
            <Link to={`/app/documents?category=${encodeURIComponent(documentCategory)}`}>{docs.toLocaleString()} {documentCategory === "FinancialStatement" ? "financial statement" : documentCategory.toLowerCase()} document{docs === 1 ? "" : "s"} in Documents</Link>
          </>
        )}
      </span>
    </div>
  );
}
