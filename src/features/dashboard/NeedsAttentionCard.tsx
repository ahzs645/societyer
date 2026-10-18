import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, ChevronRight, History, ShieldAlert } from "lucide-react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import type { DashboardComplianceFlag } from "../../../shared/dashboardComplianceRules";
import type { ContinuityCheck } from "../gaps/ContinuityChecksCard";
import { InfoPopover } from "../../components/InfoPopover";
import { getRegulatoryCitation } from "../../lib/regulatoryCitations";
import { pluralizeCounts } from "../../lib/pluralizeCounts";
import { formatShortDate, relative } from "../../lib/format";

/**
 * Phone Dashboard: one "Needs attention" list in place of the Compliance
 * posture, Record continuity and Filings cards, which repeat each other on a
 * narrow screen (director consent, the annual report). Built only from data
 * those cards already load. Each row is one link to where it gets fixed; the
 * legal source, the evidence that resolves it and any other actions sit
 * behind the row's ⓘ button.
 */

export type AttentionSeverity = "err" | "warn";
type AttentionKind = "filing" | "compliance" | "continuity";

export type AttentionSource = { label: string; citation?: string; url?: string };

export type AttentionItem = {
  key: string;
  severity: AttentionSeverity;
  kind: AttentionKind;
  title: string;
  detail?: string;
  /** Long guidance (e.g. the BC PIPA paragraph): two lines, then "More". */
  prose?: boolean;
  to?: string;
  dueDate?: string;
  sources: AttentionSource[];
  evidence: string[];
  /** Actions other than the row's own link (assign review, drafts, …). */
  actions?: ReactNode;
};

export type AttentionFiling = { _id: string; kind: string; periodLabel?: string; dueDate: string; status?: string };

/** Upcoming filings due within this many days count as needing attention. */
const UPCOMING_FILING_WINDOW_DAYS = 30;
const PREVIEW_COUNT = 5;
const PROSE_LENGTH = 120;

const KIND_ORDER: Record<AttentionKind, number> = { filing: 0, compliance: 1, continuity: 2 };
const SEVERITY_ORDER: Record<AttentionSeverity, number> = { err: 0, warn: 1 };

function flagLinkLabel(flag: DashboardComplianceFlag, to: string | undefined) {
  return to ? flag.remediationActions?.find((action) => action.intent === "navigate" && action.to === to)?.label : undefined;
}

/** "First sentence. The rest…" → title and detail. */
function splitSentence(text: string): { title: string; rest: string } {
  const match = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text.trim());
  const strip = (value: string) => value.replace(/[.]$/, "");
  return match ? { title: strip(match[1]), rest: match[2] } : { title: strip(text.trim()), rest: "" };
}

export function buildAttentionItems({
  flags,
  checks,
  overdueFilings,
  upcomingFilings,
  todayISO,
  filingLabel,
  canOpen,
  flagLink,
  flagActions,
}: {
  /** Compliance flags, or undefined when the module is hidden. */
  flags?: DashboardComplianceFlag[];
  /** Continuity checks, or undefined when the module is hidden or loading. */
  checks?: ContinuityCheck[];
  /** Filings, or undefined when the module is hidden. */
  overdueFilings?: AttentionFiling[];
  upcomingFilings?: AttentionFiling[];
  todayISO: string;
  filingLabel: (kind: string) => string;
  canOpen: (to: string) => boolean;
  flagLink: (flag: DashboardComplianceFlag) => string | undefined;
  flagActions: (flag: DashboardComplianceFlag, rowLink: string | undefined) => ReactNode;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  const filingItem = (filing: AttentionFiling, severity: AttentionSeverity): AttentionItem => {
    const due = formatShortDate(filing.dueDate, todayISO);
    const when = severity === "err" ? `Overdue · was due ${due}` : `Due ${due} (${relative(filing.dueDate)})`;
    return {
      key: `filing:${filing._id}`,
      severity,
      kind: "filing",
      title: filingLabel(filing.kind),
      detail: filing.periodLabel ? `${when} · ${filing.periodLabel}` : when,
      to: `/app/filings?filing=${encodeURIComponent(String(filing._id))}`,
      dueDate: filing.dueDate,
      sources: [],
      evidence: [],
    };
  };
  const listedFilings: AttentionFiling[] = [];
  for (const filing of overdueFilings ?? []) {
    if (filing.status === "Filed") continue;
    listedFilings.push(filing);
    items.push(filingItem(filing, "err"));
  }
  for (const filing of upcomingFilings ?? []) {
    if (filing.status === "Filed") continue;
    let days = Number.POSITIVE_INFINITY;
    try {
      days = differenceInCalendarDays(parseISO(filing.dueDate), parseISO(todayISO));
    } catch {
      // An unreadable date stays out of the short list; the Filings page has it.
    }
    if (!(days <= UPCOMING_FILING_WINDOW_DAYS)) continue;
    listedFilings.push(filing);
    items.push(filingItem(filing, "warn"));
  }

  const flagRuleIds = new Set<string>();
  for (const flag of flags ?? []) {
    if (flag.level === "ok") continue;
    flagRuleIds.add(flag.ruleId);
    const text = pluralizeCounts(flag.text);
    const { title, rest } = splitSentence(text);
    const to = flagLink(flag);
    const ids = flag.citationIds?.length ? flag.citationIds : flag.citationId ? [flag.citationId] : [];
    const sources = ids.flatMap<AttentionSource>((id) => {
      const citation = getRegulatoryCitation(id);
      return citation ? [{ label: citation.source, citation: citation.fullCitation, url: citation.url }] : [];
    });
    items.push({
      key: `flag:${flag.ruleId}`,
      severity: flag.level,
      kind: "compliance",
      title,
      // A one-sentence flag says what is wrong; the detail line says what
      // the row opens (e.g. "Update consent").
      detail: rest || (flag.remediationStatus === "open" ? "Review workflow open" : flagLinkLabel(flag, to) ?? "Compliance check"),
      prose: text.length > PROSE_LENGTH,
      to,
      sources,
      evidence: flag.evidenceRequired ?? [],
      actions: flagActions(flag, to),
    });
  }

  // Director consent is already a compliance item, and a listed annual report
  // filing says more than the continuity check for the same report.
  const annualReportListed = listedFilings.some((filing) => /annual\s*report/i.test(filing.kind) || /annual report/i.test(filingLabel(filing.kind)));
  for (const check of checks ?? []) {
    if (check.level === "ok" || check.level === "info") continue;
    if (check.id === "CONTINUITY-DIRECTOR-CONSENT" && flagRuleIds.has("BC-SOC-DIRECTOR-CONSENT")) continue;
    if (check.id === "CONTINUITY-ANNUAL-REPORT-FILED" && annualReportListed) continue;
    items.push({
      key: `continuity:${check.id}`,
      severity: check.level,
      kind: "continuity",
      title: check.title,
      detail: pluralizeCounts(check.text),
      to: canOpen(check.to) ? check.to : undefined,
      sources: check.citation ? [{ label: check.citation }] : [],
      evidence: [],
    });
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      SEVERITY_ORDER[a.item.severity] - SEVERITY_ORDER[b.item.severity]
      || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind]
      || (a.item.dueDate ?? "").localeCompare(b.item.dueDate ?? "")
      || a.index - b.index)
    .map(({ item }) => item);
}

const KIND_ICON: Record<AttentionKind, ReactNode> = {
  filing: <CalendarClock size={16} aria-hidden="true" />,
  compliance: <ShieldAlert size={16} aria-hidden="true" />,
  continuity: <History size={16} aria-hidden="true" />,
};

const SEVERITY_LABEL: Record<AttentionSeverity, string> = { err: "Urgent", warn: "To review" };

function AttentionRow({ item }: { item: AttentionItem }) {
  const detailRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  // "More" only when the two-line clamp actually cuts the text.
  useLayoutEffect(() => {
    const element = detailRef.current;
    if (!item.prose || !element) return;
    const measure = () => {
      if (!expanded) setClamped(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [item.prose, expanded]);

  const body = (
    <>
      <span className="attention-item__icon" aria-hidden="true">{KIND_ICON[item.kind]}</span>
      <span className="attention-item__text">
        <span className="attention-item__title">
          <span className="sr-only">{SEVERITY_LABEL[item.severity]}: </span>
          {item.title}
        </span>
        {item.detail && (
          <span
            ref={detailRef}
            className={`attention-item__detail${item.prose ? " attention-item__detail--prose" : ""}${expanded ? " is-expanded" : ""}`}
          >
            {item.detail}
          </span>
        )}
      </span>
      {item.to && <ChevronRight size={16} className="attention-item__chevron" aria-hidden="true" />}
    </>
  );
  const hasDetails = item.sources.length > 0 || item.evidence.length > 0 || Boolean(item.actions);
  return (
    <li className={`attention-item attention-item--${item.severity}`}>
      {item.to ? (
        <Link to={item.to} className="attention-item__main">{body}</Link>
      ) : (
        <div className="attention-item__main">{body}</div>
      )}
      {hasDetails && (
        <span className="attention-item__info">
          <InfoPopover label={item.sources.length ? `Legal source for ${item.title}` : `More about ${item.title}`}>
            <div className="attention-pop">
              {item.prose && <p>{item.title}. {item.detail}</p>}
              {item.sources.length > 0 && (
                <div>
                  <p className="attention-pop__label">Legal source</p>
                  <ul className="attention-pop__list">
                    {item.sources.map((source) => (
                      <li key={`${source.label}:${source.citation ?? ""}`}>
                        {source.url ? <a href={source.url} target="_blank" rel="noreferrer noopener">{source.label}</a> : source.label}
                        {source.citation && <span className="muted"> · {source.citation}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {item.evidence.length > 0 && (
                <div>
                  <p className="attention-pop__label">Evidence that resolves this</p>
                  <ul className="attention-pop__list">
                    {item.evidence.map((entry) => <li key={entry}>{entry}</li>)}
                  </ul>
                </div>
              )}
              {item.actions}
            </div>
          </InfoPopover>
        </span>
      )}
      {item.prose && (clamped || expanded) && (
        <button
          type="button"
          className="attention-item__more"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </li>
  );
}

/**
 * No "View all" link in the head: the list mixes filings, compliance flags
 * and continuity checks, so no one page is "all" of it, and "Show all (n)"
 * already opens the rest here. Each row links to where it gets fixed.
 */
export function NeedsAttentionCard({
  items,
  note,
}: {
  items: AttentionItem[];
  /** A muted line under the list (e.g. checks that need an administrator). */
  note?: ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, PREVIEW_COUNT);
  const urgent = items.filter((item) => item.severity === "err").length;
  return (
    <section className="card needs-attention" aria-labelledby="needs-attention-title">
      <div className="card__head">
        <h2 className="card__title" id="needs-attention-title">Needs attention</h2>
        {items.length > 0 && (
          <span className={`needs-attention__count${urgent ? " is-urgent" : ""}`}>
            {items.length}
            <span className="sr-only"> items{urgent ? `, ${urgent} urgent` : ""}</span>
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="card__body muted">Nothing needs attention right now.</div>
      ) : (
        <ul className="needs-attention__list">
          {shown.map((item) => <AttentionRow key={item.key} item={item} />)}
        </ul>
      )}
      {(items.length > PREVIEW_COUNT || note) && (
        <div className="needs-attention__foot">
          {items.length > PREVIEW_COUNT && (
            <button type="button" className="needs-attention__toggle" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show fewer" : `Show all (${items.length})`}
            </button>
          )}
          {note && <p className="needs-attention__note muted">{note}</p>}
        </div>
      )}
    </section>
  );
}
