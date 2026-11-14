/**
 * What Zoer's review recorded for the notice, read-only, in two parts. The
 * verdict sits in the notice's decision panel beside our triage, since the
 * two together answer "should we bid?": the people's decision in Zoer when
 * there is one, then the AI suggestion (labelled as one) with its five
 * factors and its reasons. The details follow the documents further down:
 * the AI summary, the requirements and whether the workspace meets them,
 * facts extracted from the documents, open tasks and changes.
 */
import { useState } from "react";
import { Badge, Pill } from "../../../components/ui";
import { ExpandableText } from "../../../components/ExpandableText";
import { formatSourceDate, type Tone } from "../lib/notice";
import type { ReviewModel } from "../lib/review";

const SHOWN_REQUIREMENTS = 5;
const when = (value: string) => (value ? formatSourceDate(value) : "");

/** "3 of 5 requirements met", or how many were found when none were matched. */
export function requirementsLine(review: ReviewModel): string {
  const { requirements } = review;
  if (!requirements.length) return "";
  const met = requirements.filter((item) => item.match?.tone === "success").length;
  return requirements.some((item) => item.match) ? `${met} of ${requirements.length} requirements met` : `${requirements.length} requirements found`;
}

/**
 * The decision panel's half from Zoer. `detailsId` is the details section
 * further down, which the requirements line links to.
 */
export function ReviewVerdict({ review, detailsId }: { review: ReviewModel; detailsId?: string }) {
  const { decision, suggestion } = review;
  const requirements = requirementsLine(review);
  const recorded = suggestion?.at || decision?.at || review.summary?.at || "";
  return (
    <section className="procurement-verdict" aria-labelledby="procurement-verdict-title">
      <h3 className="procurement-verdict__eyebrow" id="procurement-verdict-title">
        {suggestion ? "AI suggestion · not a decision" : "Reviewed in Zoer"}
      </h3>
      {decision && (
        <div className="procurement-verdict__decision">
          <span className="procurement-verdict__label">Decision in Zoer</span>
          <Badge tone={decision.tone}>{decision.label}</Badge>
          {decision.stale && <Badge tone="warn">Needs reconfirming</Badge>}
          <small className="muted">{[decision.actor, when(decision.at)].filter(Boolean).join(" · ")}</small>
          {decision.note && <ExpandableText className="procurement-verdict__note" lines={3} label="decision note">{decision.note}</ExpandableText>}
        </div>
      )}
      {suggestion && (
        <>
          <p className="procurement-verdict__title" data-tone={suggestion.tone}>
            {suggestion.label}
            {suggestion.stale && <Badge tone="warn">Evidence changed since</Badge>}
          </p>
          {suggestion.dimensions.length > 0 && (
            <dl className="procurement-verdict__factors" aria-label="Factors">
              {suggestion.dimensions.map((dim) => (
                <div key={dim.label} data-tone={dim.tone}>
                  <dt>{dim.label}</dt>
                  <dd>
                    <span className="procurement-verdict__dot" aria-hidden="true" />
                    {dim.value}
                    <span className="sr-only"> ({toneWord(dim.tone)})</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {suggestion.reasons.length > 0 && (
            <ul className="procurement-verdict__reasons">
              {suggestion.reasons.map((reason) => (
                <li key={reason}>
                  <ExpandableText lines={3} phoneLines={2} label="reason">{reason}</ExpandableText>
                </li>
              ))}
            </ul>
          )}
          {suggestion.unknowns.length > 0 && <p className="muted procurement-verdict__unknowns">Still unknown: {suggestion.unknowns.join("; ")}</p>}
        </>
      )}
      {!suggestion && !decision && review.summary && <p className="procurement-verdict__summary">{review.summary.text}</p>}
      {requirements && (
        <p className="procurement-verdict__requirements">
          {detailsId ? (
            <a
              href={`#${detailsId}`}
              onClick={(event) => {
                // In-page: no history entry, and the page scroller moves rather than the window.
                event.preventDefault();
                document.getElementById(detailsId)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {requirements}
            </a>
          ) : requirements}
        </p>
      )}
      <small className="muted procurement-verdict__source">Recorded in Zoer{recorded ? ` · ${when(recorded)}` : ""} · read only here</small>
    </section>
  );
}

const toneWord = (tone: Tone) => (tone === "success" ? "good" : tone === "warn" ? "a concern" : tone === "danger" ? "a problem" : "not judged");

/** The rest of Zoer's review: summary, requirements, extracted facts, open tasks, changes. */
export function ReviewDetails({ review, truncated, id }: { review: ReviewModel; truncated: boolean; id: string }) {
  const [allRequirements, setAllRequirements] = useState(false);
  const { summary, requirements, facts, tasks, changes, suggestion, decision } = review;
  const openTasks = tasks.filter((task) => !task.done);
  const shown = allRequirements ? requirements : requirements.slice(0, SHOWN_REQUIREMENTS);
  // Without a suggestion or decision the verdict shows the summary itself.
  const showSummary = Boolean(summary && (suggestion || decision));
  if (!showSummary && !requirements.length && !facts.length && !openTasks.length && !changes.length) return null;

  return (
    <section className="card procurement-review-card" id={id} aria-labelledby={`${id}-title`}>
      <div className="card__head">
        <h2 className="card__title" id={`${id}-title`}>From Zoer's review</h2>
      </div>
      <div className="card__body procurement-review-card__body">
        {showSummary && summary && (
          <div className="procurement-review-card__block">
            <h3 className="procurement-review-card__label">AI summary</h3>
            <ExpandableText lines={4} phoneLines={3} label="AI summary">{summary.text}</ExpandableText>
            {summary.labels.length > 0 && <div className="procurement-review-card__tags">{summary.labels.map((label) => <Pill key={label} size="sm">{label}</Pill>)}</div>}
          </div>
        )}

        {requirements.length > 0 && (
          <div className="procurement-review-card__block">
            <div className="procurement-review-card__line">
              <h3 className="procurement-review-card__label">Requirements</h3>
              <span className="muted">{requirementsLine(review).replace(" requirements", "")}</span>
            </div>
            <ul className="procurement-review-card__reqs">
              {shown.map((item, index) => (
                <li key={index}>
                  <ExpandableText className="procurement-review-card__req-text" lines={3} phoneLines={2} label="requirement">{item.text}</ExpandableText>
                  <span className="procurement-review-card__req-meta">
                    <span className="muted">{[item.strength, item.category].filter(Boolean).join(" · ")}</span>
                    {item.match && <Badge tone={item.match.tone}>{item.match.label}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
            {requirements.length > SHOWN_REQUIREMENTS && (
              <button type="button" className="btn btn--ghost btn--sm" aria-expanded={allRequirements} onClick={() => setAllRequirements(!allRequirements)}>
                {allRequirements ? "Show fewer" : `Show all ${requirements.length}`}
              </button>
            )}
          </div>
        )}

        {facts.length > 0 && (
          <div className="procurement-review-card__block">
            <h3 className="procurement-review-card__label">Extracted from the documents</h3>
            <dl className="procurement-notice__kv procurement-notice__kv--two">
              {facts.map((fact, index) => <div key={index}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
            </dl>
          </div>
        )}

        {openTasks.length > 0 && (
          <div className="procurement-review-card__block">
            <h3 className="procurement-review-card__label">Open tasks</h3>
            <ul className="procurement-review-card__list">
              {openTasks.map((task, index) => <li key={index}>{task.title}<span className="muted">{[task.owner, task.due && `due ${formatSourceDate(task.due)}`].filter(Boolean).map((part) => ` · ${part}`).join("")}</span></li>)}
            </ul>
          </div>
        )}

        {changes.length > 0 && (
          <div className="procurement-review-card__block">
            <h3 className="procurement-review-card__label">Changes</h3>
            <ul className="procurement-review-card__list">
              {changes.slice(0, 5).map((change, index) => <li key={index}>{change.text}<span className="muted"> · {when(change.at)}{change.acknowledged ? "" : " · new"}</span></li>)}
            </ul>
          </div>
        )}
        {truncated && <p className="muted procurement-review-card__source">Showing the first part of a long review; open the notice in Zoer for the rest.</p>}
      </div>
    </section>
  );
}
