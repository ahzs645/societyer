/**
 * What Zoer's review recorded for the notice, read-only: the people's
 * decision first, then the AI suggestion (labelled as one) with its reasons,
 * the requirements and whether the workspace meets them, extracted facts,
 * tasks and changes. The notice page shows it as its Review tab.
 */
import { useState } from "react";
import { Badge, Pill } from "../../../components/ui";
import { ExpandableText } from "../../../components/ExpandableText";
import { formatSourceDate } from "../lib/notice";
import type { ReviewModel } from "../lib/review";

const SHOWN_REQUIREMENTS = 5;
const when = (value: string) => (value ? formatSourceDate(value) : "");

export function NoticeReview({ review, truncated }: { review: ReviewModel; truncated: boolean }) {
  const [allRequirements, setAllRequirements] = useState(false);
  const { decision, suggestion, summary, requirements, facts, tasks, changes } = review;
  const openTasks = tasks.filter((task) => !task.done);
  const met = requirements.filter((item) => item.match?.tone === "success").length;
  const shown = allRequirements ? requirements : requirements.slice(0, SHOWN_REQUIREMENTS);

  return (
    <section className="card procurement-review-card" aria-label="Review from Zoer">
      <div className="card__body procurement-review-card__body">
        {decision && (
          <div className="procurement-review-card__block">
            <div className="procurement-review-card__line">
              <span className="procurement-review-card__label">Decision</span>
              <Badge tone={decision.tone}>{decision.label}</Badge>
              {decision.stale && <Badge tone="warn">Needs reconfirming</Badge>}
            </div>
            {decision.note && <ExpandableText lines={3} label="decision note">{decision.note}</ExpandableText>}
            <small className="muted">{[decision.actor, when(decision.at)].filter(Boolean).join(" · ")}</small>
          </div>
        )}

        {suggestion && (
          <div className="procurement-review-card__block">
            <div className="procurement-review-card__line">
              <span className="procurement-review-card__label">AI suggestion</span>
              <Badge tone={suggestion.tone}>{suggestion.label}</Badge>
              {suggestion.stale && <Badge tone="warn">Evidence changed since</Badge>}
            </div>
            {suggestion.dimensions.length > 0 && (
              <dl className="procurement-review-card__dims">
                {suggestion.dimensions.map((dim) => <div key={dim.label} data-tone={dim.tone}><dt>{dim.label}</dt><dd>{dim.value}</dd></div>)}
              </dl>
            )}
            {suggestion.reasons.length > 0 && <ul className="procurement-review-card__list">{suggestion.reasons.map((reason) => <li key={reason}><ExpandableText lines={3} phoneLines={2} label="reason">{reason}</ExpandableText></li>)}</ul>}
            {suggestion.unknowns.length > 0 && <p className="muted">Still unknown: {suggestion.unknowns.join("; ")}</p>}
            <small className="muted">Not a decision{suggestion.at ? ` · ${when(suggestion.at)}` : ""}</small>
          </div>
        )}

        {summary && (
          <div className="procurement-review-card__block">
            <span className="procurement-review-card__label">AI summary</span>
            <ExpandableText lines={4} phoneLines={3} label="AI summary">{summary.text}</ExpandableText>
            {summary.labels.length > 0 && <div className="procurement-review-card__tags">{summary.labels.map((label) => <Pill key={label} size="sm">{label}</Pill>)}</div>}
          </div>
        )}

        {requirements.length > 0 && (
          <div className="procurement-review-card__block">
            <div className="procurement-review-card__line">
              <span className="procurement-review-card__label">Requirements</span>
              <span className="muted">{requirements.some((item) => item.match) ? `${met} of ${requirements.length} met` : `${requirements.length} found`}</span>
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
            <span className="procurement-review-card__label">Extracted from the documents</span>
            <dl className="procurement-notice__kv procurement-notice__kv--two">
              {facts.map((fact, index) => <div key={index}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
            </dl>
          </div>
        )}

        {openTasks.length > 0 && (
          <div className="procurement-review-card__block">
            <span className="procurement-review-card__label">Open tasks</span>
            <ul className="procurement-review-card__list">
              {openTasks.map((task, index) => <li key={index}>{task.title}<span className="muted">{[task.owner, task.due && `due ${formatSourceDate(task.due)}`].filter(Boolean).map((part) => ` · ${part}`).join("")}</span></li>)}
            </ul>
          </div>
        )}

        {changes.length > 0 && (
          <div className="procurement-review-card__block">
            <span className="procurement-review-card__label">Changes</span>
            <ul className="procurement-review-card__list">
              {changes.slice(0, 5).map((change, index) => <li key={index}>{change.text}<span className="muted"> · {when(change.at)}{change.acknowledged ? "" : " · new"}</span></li>)}
            </ul>
          </div>
        )}
        <p className="muted procurement-review-card__source">Recorded in Zoer · read only here{truncated ? " · showing the first part of a long review; open the notice in Zoer for the rest" : ""}</p>
      </div>
    </section>
  );
}
