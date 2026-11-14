/**
 * "Should we bid?" in one place, right under the header: our triage
 * (Reviewed, Classification, action items) beside Zoer's verdict (the AI
 * suggestion with its five factors and its reasons, or the decision people
 * recorded in Zoer). Side by side where the panel is wide enough, one above
 * the other where it isn't (a container query on the panel itself).
 *
 * It shows what exists: the triage alone where Zoer hasn't reviewed the
 * notice (saying so), the verdict alone where the reader has no triage (the
 * offline snapshot, and awards, which aren't triaged), and nothing at all
 * when there is neither.
 */
import { Skeleton } from "../../../../components/ui";
import type { TriageTaskNotice } from "../../../../../shared/procurementTriage";
import type { ReviewModel } from "../../lib/review";
import { NoticeTriage, type NoticeTriageControl } from "../NoticeTriageBar";
import { ReviewVerdict } from "../NoticeReview";

export function DecisionPanel({
  id,
  recordKey,
  notice,
  control,
  review,
  reviewLoading,
  detailsId,
  hint,
}: {
  /** The panel's anchor (`?tab=review` scrolls to it). */
  id: string;
  recordKey: string;
  notice: TriageTaskNotice;
  /** Our triage; null for an award or where the reader has none. */
  control: NoticeTriageControl | null;
  review: ReviewModel | null;
  reviewLoading: boolean;
  /** The review details further down, which the verdict's requirements line links to. */
  detailsId?: string;
  /** Show the triage's keyboard shortcuts (desktop). */
  hint: boolean;
}) {
  const reviewed = review && !review.empty;
  const verdict = reviewed ? (
    <ReviewVerdict review={review} detailsId={detailsId} />
  ) : reviewLoading && control ? (
    <div className="procurement-verdict" aria-busy="true">
      <Skeleton variant="line" width="40%" />
      <Skeleton variant="line" width="70%" />
    </div>
  ) : control ? (
    <p className="procurement-verdict procurement-verdict--none muted">Zoer hasn't reviewed this notice, so there is no AI suggestion.</p>
  ) : null;
  if (!control && !verdict) return null;
  return (
    <section className="card procurement-decision" id={id} aria-labelledby={`${id}-title`}>
      <h2 className="sr-only" id={`${id}-title`}>
        Bid decision
      </h2>
      <div className="procurement-decision__halves" data-count={control && verdict ? 2 : 1}>
        {control && <NoticeTriage control={control} recordKey={recordKey} notice={notice} hint={hint} />}
        {verdict}
      </div>
    </section>
  );
}
