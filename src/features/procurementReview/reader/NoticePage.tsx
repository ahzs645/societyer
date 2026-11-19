/**
 * One published notice, as the content of the notice panel
 * (notice/NoticePanel.tsx), which brings the chrome: the header with
 * previous and next, Minimise, Full screen and Close, and the footer with
 * Classify and the buyer's site. The page itself opens with the title, the
 * buyer and the status ("what, who, still open?"); right under it, the
 * decision panel answers "should we bid?" (our triage beside Zoer's AI
 * suggestion); then the buyer's description, the documents (or one line
 * saying there are none), Zoer's review details, and the source's other
 * fields. An award opens with what was awarded, to whom and for how much,
 * and ends with the supplier's and the buyer's other awards.
 *
 * The page lays itself out by its own width (notice/layout.ts), so it reads
 * well in the panel at its usual 480px, as the panel is dragged wider, full
 * screen, and in a phone's page sheet: wide, the facts and buyer contact sit
 * in a rail that stays in view; stacked, the key facts are a strip under the
 * header and the rest follow the documents; narrow, the same with the
 * details folded at the end.
 *
 * `?tab=documents` and `?tab=review` (the list's paperclip, older links)
 * scroll to the documents and the decision panel. The buyer, issued-for and
 * supplier names open that organisation's page, and its Back names this
 * notice.
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { FileSearch } from "lucide-react";
import { EmptyState, Skeleton } from "../../../components/ui";
import { mobileCardMediaQuery } from "../../../lib/breakpoints";
import { useMediaQuery } from "../../../lib/useSheetDrag";
import type { NoticeModel } from "../lib/notice";
import { describeReview } from "../lib/review";
import { NoticeDocuments } from "./NoticeDocuments";
import { ReviewDetails } from "./NoticeReview";
import type { NoticeTriageControl } from "./NoticeTriageBar";
import { triageTaskNotice } from "./triage";
import { ReaderPlaceTitleContext } from "./routes";
import { useReaderSource } from "./source";
import { useNoticeLayout } from "./notice/layout";
import { DecisionPanel } from "./notice/DecisionPanel";
import { AWARD_CARD_FACTS, AwardCard, RelatedAwards } from "./notice/AwardParts";
import { AllDetails, Description, FactStrip, NoticeBadges, NoticeContacts, NoticeFacts, NoticeFields, PartyLink, SourceCapture } from "./notice/NoticeParts";

/** The sections `?tab=` scrolls to, and the verdict's link to the review details. */
const DECISION_ID = "procurement-notice-decision";
const DOCUMENTS_ID = "procurement-notice-documents";
const REVIEW_DETAILS_ID = "procurement-notice-review";

/** A notice as the source published it (ReaderSource `useRecord`). */
export type NoticeRecord = NonNullable<ReturnType<ReturnType<typeof useReaderSource>["useRecord"]>>;

/** Runs `run` a few frames from now: after the panel's card has laid out. */
function afterFrames(count: number, run: () => void): () => void {
  let frame = requestAnimationFrame(function next() {
    if (--count <= 0) run();
    else frame = requestAnimationFrame(next);
  });
  return () => cancelAnimationFrame(frame);
}

/** The title and the buyer, as the panel's content opens. */
function NoticeHead({ title, buyer }: { title: string; buyer?: string }) {
  return (
    <header className="procurement-notice__head">
      <h2 className="procurement-notice__title">{title}</h2>
      {buyer && (
        <p className="procurement-notice__buyer">
          <PartyLink party="organization" name={buyer} />
        </p>
      )}
    </header>
  );
}

/** While the notice loads. */
export function NoticeLoading({ rootRef }: { rootRef: (node: HTMLDivElement | null) => void }) {
  return (
    <div ref={rootRef} className="procurement-notice" aria-busy="true">
      <NoticeHead title="Loading notice…" />
      <div className="card">
        <div className="card__body col">
          <Skeleton variant="line" width="90%" />
          <Skeleton variant="line" width="80%" />
          <Skeleton variant="line" width="60%" />
        </div>
      </div>
    </div>
  );
}

/** A key the catalog doesn't have (an old link, another workspace's). */
export function NoticeMissing({ rootRef, action }: { rootRef: (node: HTMLDivElement | null) => void; action: ReactNode }) {
  return (
    <div ref={rootRef} className="procurement-notice">
      <NoticeHead title="Notice not found" />
      <EmptyState
        icon={<FileSearch size={18} />}
        title="This notice isn't in the published catalog"
        description="Zoer may have published a newer catalog without it, or the link is from another workspace."
        action={action}
      />
    </div>
  );
}

export function NoticePage({
  recordKey,
  record,
  data,
  model,
  triage,
  root,
  rootRef,
}: {
  recordKey: string;
  record: NoticeRecord;
  data: unknown;
  model: NoticeModel;
  /** Our triage of an opportunity; null for an award or where the reader has none. */
  triage: NoticeTriageControl | null;
  /** The page's root, measured for its layout; the panel keeps it for the notice's keys. */
  root: HTMLElement | null;
  rootRef: (node: HTMLDivElement | null) => void;
}) {
  const source = useReaderSource();
  const documents = source.useDocuments(recordKey, null);
  const reviewRows = source.useReview(recordKey);
  const review = useMemo(() => (reviewRows ? describeReview(reviewRows.rows) : null), [reviewRows]);
  const layout = useNoticeLayout(root);
  // The triage's key hints are for a keyboard, not a phone.
  const phone = useMediaQuery(mobileCardMediaQuery);

  // `?tab=` names a section to scroll to, once what is above it has loaded.
  const [params] = useSearchParams();
  const requested = params.get("tab");
  const ready = reviewRows !== undefined && documents !== undefined;
  useEffect(() => {
    if (!ready || (requested !== "documents" && requested !== "review")) return;
    return afterFrames(3, () => document.getElementById(requested === "documents" ? DOCUMENTS_ID : DECISION_ID)?.scrollIntoView({ block: "start" }));
  }, [ready, requested]);

  const narrow = layout === "narrow";
  const wide = layout === "wide";
  const award = model.kind === "award";
  const notice = triageTaskNotice({
    title: model.title,
    buyer: model.buyer,
    date: record.summary.date,
    dateText: record.summary.dateText,
    reference: model.reference,
  });
  const facts = <NoticeFacts model={model} omit={award ? AWARD_CARD_FACTS : []} />;
  const contacts = <NoticeContacts model={model} />;
  const sourceFields = (
    <>
      <NoticeFields model={model} />
      <SourceCapture data={data} />
    </>
  );

  return (
    // A buyer opened from here says "Back to <this notice>".
    <ReaderPlaceTitleContext.Provider value={model.title}>
      <div ref={rootRef} className="procurement-notice" data-layout={layout}>
        <NoticeHead title={model.title} buyer={model.buyer} />
        <NoticeBadges model={model} />
        {record.removed && (
          <p className="card card__body" role="status">
            This notice was removed from the current source. Its last published details are retained for reference.
          </p>
        )}
        {!wide && !award && <FactStrip model={model} />}
        <div className="procurement-notice__layout">
          <div className="procurement-notice__main">
            {award && <AwardCard model={model} />}
            <DecisionPanel
              id={DECISION_ID}
              recordKey={recordKey}
              notice={notice}
              control={triage}
              review={review}
              reviewLoading={reviewRows === undefined}
              detailsId={REVIEW_DETAILS_ID}
              hint={!phone}
            />
            {model.description ? (
              <Description text={model.description} />
            ) : (
              !award && <p className="muted procurement-notice__no-description">The source published no description for this notice.</p>
            )}
            <NoticeDocuments recordKey={recordKey} model={model} id={DOCUMENTS_ID} defaultOpen={requested === "documents"} />
            {review && reviewRows && <ReviewDetails review={review} truncated={reviewRows.truncated} id={REVIEW_DETAILS_ID} />}
            {award && <RelatedAwards model={model} recordKey={recordKey} />}
            {wide ? sourceFields : <AllDetails folded={narrow} facts={facts} contacts={contacts} rest={sourceFields} />}
          </div>
          {wide && (
            <aside className="procurement-notice__side" aria-label="Facts and buyer contact">
              {facts}
              {contacts}
            </aside>
          )}
        </div>
      </div>
    </ReaderPlaceTitleContext.Provider>
  );
}
