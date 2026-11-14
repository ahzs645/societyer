/**
 * One published notice, as one scrolling page. The header answers "what,
 * who, still open?"; right under it, the decision panel answers "should we
 * bid?" (our triage beside Zoer's AI suggestion); then the buyer's
 * description, the documents (or one line saying there are none), Zoer's
 * review details, and the source's other fields. An award opens with what
 * was awarded, to whom and for how much, and ends with the supplier's and the
 * buyer's other awards.
 *
 * The page lays itself out by its own width (notice/layout.ts), so it reads
 * the same at full width, in the list's pane beside the list, and on a phone:
 * wide, the facts and buyer contact sit in a rail that stays in view; stacked,
 * the key facts are a strip under the header and the rest follow the
 * documents; narrow (phones), an app bar keeps Back and the notice's title in
 * view, the details fold at the end, and Classify and the buyer's site sit in
 * a bar at the bottom of the screen.
 *
 * `?tab=documents` and `?tab=review` (the list's paperclip, older links)
 * scroll to the documents and the decision panel. Back names the place it
 * returns to; previous and next step through the list the notice was opened
 * from (notice/NoticePager.tsx). The buyer, issued-for and supplier names open
 * that organisation's page, and its Back names this notice.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ExternalLink, FileSearch } from "lucide-react";
import { EmptyState, Skeleton } from "../../../components/ui";
import { describeNotice } from "../lib/notice";
import { describeReview } from "../lib/review";
import { NoticeDocuments } from "./NoticeDocuments";
import { ReviewDetails } from "./NoticeReview";
import { useNoticeTriage } from "./NoticeTriageBar";
import { triageTaskNotice } from "./triage";
import { ReaderPlaceTitleContext } from "./routes";
import { ReaderBackButton, ReaderHeader } from "./ReaderHeader";
import { useReaderSource } from "./source";
import { useNoticeLayout } from "./notice/layout";
import { DecisionPanel } from "./notice/DecisionPanel";
import { AWARD_CARD_FACTS, AwardCard, RelatedAwards } from "./notice/AwardParts";
import { NoticePager, useNoticeNeighbours, useNoticeShortcuts } from "./notice/NoticePager";
import { NoticeActionBar, NoticeAppBar, shortSiteName } from "./notice/PhoneBars";
import { AllDetails, Description, FactStrip, NoticeBadges, NoticeContacts, NoticeFacts, NoticeFields, PartyLink, SourceCapture } from "./notice/NoticeParts";

/** Not a registered route, so the header shows no icon tile: beside a two-line notice title it wraps onto its own line. */
const NOTICE_ROUTE_KEY = "procurement-review/notice";
/** The sections `?tab=` scrolls to, and the verdict's link to the review details. */
const DECISION_ID = "procurement-notice-decision";
const DOCUMENTS_ID = "procurement-notice-documents";
const REVIEW_DETAILS_ID = "procurement-notice-review";

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/** Runs `run` a few frames from now: after the reader has put the page at its top (ProcurementReader's scroll memory). */
function afterFrames(count: number, run: () => void): () => void {
  let frame = requestAnimationFrame(function next() {
    if (--count <= 0) run();
    else frame = requestAnimationFrame(next);
  });
  return () => cancelAnimationFrame(frame);
}

export function NoticePage({ recordKey }: { recordKey: string }) {
  const source = useReaderSource();
  const record = source.useRecord(recordKey);
  const documents = source.useDocuments(recordKey, null);
  const reviewRows = source.useReview(recordKey);
  const data = useMemo(() => (record ? parse(record.dataJson) : null), [record]);
  const model = useMemo(() => (record ? describeNotice(record.summary, data) : null), [record, data]);
  const review = useMemo(() => (reviewRows ? describeReview(reviewRows.rows) : null), [reviewRows]);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const layout = useNoticeLayout(root);
  const neighbours = useNoticeNeighbours(recordKey);
  const control = useNoticeTriage(recordKey, model?.title ?? "");
  // Triage is for opportunities only.
  const triage = model?.kind === "opportunity" ? control : null;
  const [announcement, setAnnouncement] = useState("");
  useNoticeShortcuts({ root, neighbours, triage, announce: setAnnouncement });

  useEffect(() => {
    root?.closest(".page")?.scrollTo({ top: 0 });
  }, [root, recordKey]);

  // `?tab=` names a section to scroll to, once what is above it has loaded.
  const [params] = useSearchParams();
  const requested = params.get("tab");
  const ready = Boolean(model) && reviewRows !== undefined && documents !== undefined;
  useEffect(() => {
    if (!ready || (requested !== "documents" && requested !== "review")) return;
    return afterFrames(3, () => document.getElementById(requested === "documents" ? DOCUMENTS_ID : DECISION_ID)?.scrollIntoView({ block: "start" }));
  }, [ready, requested]);

  if (record === undefined) {
    return (
      <div ref={setRoot} className="procurement-notice" aria-busy="true">
        <ReaderHeader title="Loading notice…" routeKey={NOTICE_ROUTE_KEY} />
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
  if (!record || !model) {
    return (
      <div ref={setRoot} className="procurement-notice">
        <ReaderHeader title="Notice not found" routeKey={NOTICE_ROUTE_KEY} />
        <EmptyState
          icon={<FileSearch size={18} />}
          title="This notice isn't in the published catalog"
          description="Zoer may have published a newer catalog without it, or the link is from another workspace."
          action={<ReaderBackButton />}
        />
      </div>
    );
  }

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
      <div ref={setRoot} className="procurement-notice" data-layout={layout}>
        {narrow && <NoticeAppBar root={root} title={model.title} sourceUrl={model.sourceUrl} source={model.source} neighbours={neighbours} />}
        <ReaderHeader
          title={model.title}
          routeKey={NOTICE_ROUTE_KEY}
          back={narrow ? "none" : "words"}
          trailing={neighbours && <NoticePager neighbours={neighbours} />}
          subtitle={model.buyer ? <PartyLink party="organization" name={model.buyer} /> : undefined}
          actions={
            !narrow &&
            model.sourceUrl && (
              <a className="btn" href={model.sourceUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} aria-hidden="true" /> View on {shortSiteName(model.source)}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )
          }
        />
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
              hint={!narrow}
            />
            {model.description ? (
              <Description text={model.description} />
            ) : (
              !award && <p className="muted procurement-notice__no-description">The source published no description for this notice.</p>
            )}
            <NoticeDocuments recordKey={recordKey} model={model} id={DOCUMENTS_ID} />
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
        {narrow && <NoticeActionBar control={triage} sourceUrl={model.sourceUrl} source={model.source} />}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </ReaderPlaceTitleContext.Provider>
  );
}
