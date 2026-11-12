/**
 * One published notice. The header answers "what, who, still open?"; the body
 * is in tabs so a phone isn't one endless scroll: Overview (the facts, the
 * buyer's description, whom to ask, and only those source fields that add
 * something), Documents, and Review when Zoer reviewed it. Desktop keeps the
 * facts and contact beside every tab; phones and tablets open Overview with
 * them, under the tabs.
 *
 * Back (ReaderHeader: above the title, or beside it on phones) names the place
 * it returns to, the list or the buyer page the notice was opened from, so the
 * list underneath comes back at the same rows. The buyer and issued-for names
 * open that organisation's page, and its Back names this notice; they are real
 * links, so a middle-click or a long-press opens it in a new tab.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  ChevronRight,
  ExternalLink,
  FileSearch,
  Gavel,
  Mail,
  MapPin,
  Phone,
  Sparkles,
} from "lucide-react";
import {
  Badge,
  EmptyState,
  Skeleton,
  TintedIconTile,
} from "../../../components/ui";
import { ExpandableText } from "../../../components/ExpandableText";
import { Tooltip } from "../../../components/Tooltip";
import { Progress, Tabs } from "../../../components/primitives";
import { useMediaQuery } from "../../../lib/useSheetDrag";
import {
  describeNotice,
  formatSourceDate,
  noticeDocumentRows,
  parseSourceDate,
  partyCount,
  type NoticeContact,
  type NoticeModel,
  type NoticeParty,
  type Tone,
} from "../lib/notice";
import { describeReview, type ReviewModel } from "../lib/review";
import { NoticeDocuments } from "./NoticeDocuments";
import { NoticeReview } from "./NoticeReview";
import { NoticeTriage } from "./NoticeTriageBar";
import { triageTaskNotice } from "./triage";
import {
  BUYER_PARAM,
  ISSUED_FOR_PARAM,
  NOTICE_PARAM,
  ReaderPlaceTitleContext,
  useReaderNavigation,
} from "./routes";
import { plainClick, ReaderBackButton, ReaderHeader } from "./ReaderHeader";
import { useReaderSource } from "./source";

/** Not a registered route, so the header shows no icon tile: beside a two-line notice title it wraps onto its own line. */
const NOTICE_ROUTE_KEY = "procurement-review/notice";
/** Matches the layout breakpoint in _procurement-review.scss. */
const STACKED = "(max-width: 1100px)";

type NoticeTab = "overview" | "documents" | "review";
const isTab = (value: string | null): value is NoticeTab =>
  value === "overview" || value === "documents" || value === "review";

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function NoticePage({ recordKey }: { recordKey: string }) {
  const source = useReaderSource();
  const record = source.useRecord(recordKey);
  const documents = source.useDocuments(recordKey, null);
  const reviewRows = source.useReview(recordKey);
  const model = useMemo(
    () =>
      record ? describeNotice(record.summary, parse(record.dataJson)) : null,
    [record],
  );
  const review = useMemo(
    () => (reviewRows ? describeReview(reviewRows.rows) : null),
    [reviewRows],
  );
  const stacked = useMediaQuery(STACKED);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const requested = params.get("tab");
  const hasReview = Boolean(review && !review.empty);
  const tab: NoticeTab =
    isTab(requested) && (requested !== "review" || hasReview)
      ? requested
      : "overview";
  const setTab = (next: NoticeTab) =>
    setParams(
      (current) => {
        const nextParams = new URLSearchParams(current);
        if (next === "overview") nextParams.delete("tab");
        else nextParams.set("tab", next);
        return nextParams;
      },
      // Keep the entry's state: it says where Back leads.
      { replace: true, state: location.state },
    );
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    top.current?.closest(".page")?.scrollTo({ top: 0 });
  }, [recordKey]);

  if (record === undefined) {
    return (
      <div ref={top} className="procurement-notice" aria-busy="true">
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
      <div ref={top} className="procurement-notice">
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

  const documentCount = documents?.isDone
    ? noticeDocumentRows(documents.page, model.attachments, true).length
    : null;
  const tabs: { id: NoticeTab; label: string; count?: number | null }[] = [
    { id: "overview", label: "Overview" },
    { id: "documents", label: "Documents", count: documentCount || null },
    ...(hasReview ? [{ id: "review" as const, label: "Review" }] : []),
  ];
  // Our triage heads the side column; when the layout stacks, it sits above the tabs.
  const triage = model.kind === "opportunity" && (
    <NoticeTriage
      recordKey={recordKey}
      notice={triageTaskNotice({
        title: model.title,
        buyer: model.buyer,
        date: record.summary.date,
        dateText: record.summary.dateText,
        reference: model.reference,
      })}
    />
  );

  return (
    // A buyer opened from here says "Back to <this notice>".
    <ReaderPlaceTitleContext.Provider value={model.title}>
      <div ref={top} className="procurement-notice">
        <ReaderHeader
          title={model.title}
          routeKey={NOTICE_ROUTE_KEY}
          subtitle={
            model.buyer ? (
              <PartyLink party="organization" name={model.buyer} />
            ) : undefined
          }
          actions={
            model.sourceUrl && (
              <a
                className="btn"
                href={model.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View on ${model.source}`}
              >
                <ExternalLink size={14} aria-hidden="true" />{" "}
                <span className="procurement-notice__source-label">
                  View on{" "}
                  {model.source === "Buyer's website"
                    ? "buyer's site"
                    : model.source}
                </span>
              </a>
            )
          }
        />
        <NoticeBadges model={model} />
        {record.removed && (
          <p className="card card__body" role="status">
            This notice was removed from the current source. Its last published
            details are retained for reference.
          </p>
        )}
        {stacked && triage}
        <div className="procurement-notice__layout">
          <div className="procurement-notice__main">
            <Tabs
              value={tab}
              onChange={setTab}
              items={tabs}
              tabRoles
              ariaLabel="Notice sections"
            />
            <div
              role="tabpanel"
              aria-label={tabs.find((item) => item.id === tab)?.label}
              className="procurement-notice__panel"
            >
              {tab === "overview" && (
                <>
                  {stacked && <NoticeFacts model={model} />}
                  {review && !review.empty && (
                    <ReviewTeaser
                      review={review}
                      onOpen={() => setTab("review")}
                    />
                  )}
                  {model.description && (
                    <Description text={model.description} />
                  )}
                  {stacked && <NoticeContacts model={model} />}
                  <NoticeFields model={model} />
                  <SourceCapture data={parse(record.dataJson)} />
                  {!model.description &&
                    model.fields.length === 0 &&
                    !stacked && (
                      <p className="muted">
                        The source published no description for this notice.
                      </p>
                    )}
                </>
              )}
              {tab === "documents" && (
                <NoticeDocuments recordKey={recordKey} model={model} />
              )}
              {tab === "review" && reviewRows && review && (
                <NoticeReview
                  review={review}
                  truncated={reviewRows.truncated}
                />
              )}
            </div>
          </div>
          {!stacked && (
            <aside
              className="procurement-notice__side"
              aria-label="Notice details"
            >
              {triage}
              <NoticeFacts model={model} />
              <NoticeContacts model={model} />
            </aside>
          )}
        </div>
      </div>
    </ReaderPlaceTitleContext.Provider>
  );
}

/** Status and how long is left, with the source's own wording when the two disagree. */
function NoticeBadges({ model }: { model: NoticeModel }) {
  const { status, deadline } = model;
  const left =
    deadline && deadline.state !== "closed" && deadline.state !== "unknown" ? (
      <Badge
        tone={
          deadline.state === "soon" || deadline.state === "today"
            ? "warn"
            : "neutral"
        }
      >
        {deadline.state === "today"
          ? "Closes today"
          : `Closes ${deadline.relative}`}
      </Badge>
    ) : null;
  if (!status && !left) return null;
  return (
    <div className="procurement-notice__badges">
      {status && <Badge tone={status.tone}>{status.label}</Badge>}
      {left}
      {(deadline?.state === "closed" || status?.note) && (
        <span className="muted">
          {[deadline?.state === "closed" ? deadline.relative : "", status?.note]
            .filter(Boolean)
            .join(" · ")
            .replace(/^./, (c) => c.toUpperCase())}
        </span>
      )}
    </div>
  );
}

function NoticeFacts({ model }: { model: NoticeModel }) {
  return (
    <section
      className="procurement-notice__facts card"
      aria-label="Notice details"
    >
      <div className="card__body">
        <dl className="procurement-notice__kv">
          {model.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>
                {fact.party ? (
                  <PartyLink
                    party={fact.party}
                    name={fact.value}
                    countKind={model.kind}
                  />
                ) : (
                  fact.value
                )}
              </dd>
            </div>
          ))}
          <div>
            <dt>Source</dt>
            <dd>{model.source}</dd>
          </div>
        </dl>
      </div>
      {/* Its own section of the card, so the rule above it runs edge to edge. */}
      {model.commodities.length > 0 && (
        <div className="card__body procurement-notice__commodities">
          <span className="procurement-notice__kv-label">
            {model.commodities.length === 1 ? "Commodity" : "Commodities"}
          </span>
          <ul>
            {model.commodities.slice(0, 6).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {model.commodities.length > 6 && (
            <span className="muted">
              and {model.commodities.length - 6} more
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function NoticeContacts({ model }: { model: NoticeModel }) {
  if (!model.contacts.length && !model.contactAddress) return null;
  return (
    <section
      className="procurement-notice__contact card"
      aria-labelledby="procurement-notice-contact"
    >
      <div className="card__head">
        <h2 className="card__title" id="procurement-notice-contact">
          {model.contacts.length > 1 ? "Buyer contacts" : "Buyer contact"}
        </h2>
      </div>
      <div className="card__body col">
        {model.contacts.map((contact) => (
          <ContactPerson
            key={`${contact.name}|${contact.email}|${contact.phone}`}
            contact={contact}
          />
        ))}
        {model.contactAddress && (
          <div className="procurement-notice__person">
            <span className="procurement-notice__line procurement-notice__address">
              <MapPin size={13} aria-hidden="true" />
              <span>{model.contactAddress}</span>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

/** One person, one line per detail: a long address ends in "…" and shows in full on hover or focus; the links still mail or call. */
function ContactPerson({ contact }: { contact: NoticeContact }) {
  return (
    <div className="procurement-notice__person">
      {contact.name && (
        <OneLine
          value={contact.name}
          className="procurement-notice__person-name"
        />
      )}
      {contact.role && <OneLine value={contact.role} className="muted" />}
      {contact.email && (
        <OneLine
          value={contact.email}
          href={`mailto:${contact.email}`}
          icon={<Mail size={13} aria-hidden="true" />}
        />
      )}
      {contact.phone && (
        <OneLine
          value={contact.phone}
          href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
          icon={<Phone size={13} aria-hidden="true" />}
        />
      )}
    </div>
  );
}

/** A value kept to one line; the full value shows in the shared tooltip only when the line is cut short. */
function OneLine({
  value,
  href,
  icon,
  className,
}: {
  value: string;
  href?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const text = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const node = text.current;
    if (!node) return;
    const check = () => setTruncated(node.scrollWidth > node.clientWidth + 1);
    check();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [value]);
  const body = (
    <>
      {icon}
      <span ref={text} className="procurement-notice__line-text">
        {value}
      </span>
    </>
  );
  const line = `procurement-notice__line${className ? ` ${className}` : ""}`;
  return (
    <Tooltip content={value} disabled={!truncated}>
      {href ? (
        <a className={line} href={href}>
          {body}
        </a>
      ) : (
        <span className={line}>{body}</span>
      )}
    </Tooltip>
  );
}

/**
 * A buyer or issued-for name that opens the organisation's page. With
 * `countKind`, says how many of that kind's notices name it, once the list
 * has loaded (and only when there are others).
 */
function PartyLink({
  party,
  name,
  countKind,
}: {
  party: NoticeParty;
  name: string;
  countKind?: string;
}) {
  const { params, openParty, pushed, back } = useReaderNavigation();
  // Opened from this organisation's own page: its link goes back there rather than opening it again.
  const fromHere =
    pushed &&
    params.get(party === "organization" ? BUYER_PARAM : ISSUED_FOR_PARAM) ===
      name;
  const source = useReaderSource();
  const href = useMemo(() => {
    const next = new URLSearchParams(params);
    next.delete(NOTICE_PARAM);
    next.delete("tab");
    next.delete(party === "organization" ? ISSUED_FOR_PARAM : BUYER_PARAM);
    next.set(party === "organization" ? BUYER_PARAM : ISSUED_FOR_PARAM, name);
    return `?${next.toString()}`;
  }, [params, party, name]);
  return (
    <a
      className="procurement-notice__party"
      href={href}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        if (fromHere) back();
        else openParty(party, name);
      }}
    >
      <span className="procurement-notice__party-name">{name}</span>
      {/* The list hook is newer than some sources; without it there is simply no count. */}
      {countKind && typeof source.useList === "function" && (
        <PartyCount kind={countKind} party={party} name={name} />
      )}
    </a>
  );
}

function PartyCount({
  kind,
  party,
  name,
}: {
  kind: string;
  party: NoticeParty;
  name: string;
}) {
  const source = useReaderSource();
  return source.usePage ? null : (
    <SnapshotPartyCount kind={kind} party={party} name={name} />
  );
}
function SnapshotPartyCount({
  kind,
  party,
  name,
}: {
  kind: string;
  party: NoticeParty;
  name: string;
}) {
  const list = useReaderSource().useList(kind);
  const count = list?.done ? partyCount(list.rows, party, name) : null;
  if (!count) return null;
  return (
    <small className="procurement-notice__party-count">
      {count} {kind === "award" ? "awards" : "opportunities"}
    </small>
  );
}

function NoticeFields({ model }: { model: NoticeModel }) {
  if (!model.fields.length) return null;
  return (
    <section className="card" aria-labelledby="procurement-notice-fields">
      <div className="card__head">
        <h2 className="card__title" id="procurement-notice-fields">
          More from the notice
        </h2>
      </div>
      <div className="card__body">
        <dl className="procurement-notice__fields">
          {model.fields.map((field, index) => (
            <div
              key={`${field.label}-${index}`}
              data-long={field.long || undefined}
            >
              <dt>{field.label}</dt>
              <dd>
                <ExpandableText lines={4} phoneLines={3} label={field.label}>
                  {field.value}
                </ExpandableText>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** "Oct 16": the day a decision was recorded, in the source zone. */
const decisionDay = (at: string) => {
  const day = parseSourceDate(at)?.date;
  return day ? formatSourceDate(day, { withYear: false }) : "";
};

const TILE_TONES: Record<Tone, "green" | "orange" | "red" | "blue" | "gray"> = {
  success: "green",
  warn: "orange",
  danger: "red",
  info: "blue",
  neutral: "gray",
};

/**
 * The review in one tappable row on Overview: who or what said what (the
 * people's decision wins over the AI suggestion), and how the requirements
 * stand as a bar. The whole row opens the Review tab.
 */
function ReviewTeaser({
  review,
  onOpen,
}: {
  review: ReviewModel;
  onOpen: () => void;
}) {
  const { decision, suggestion, requirements, tasks } = review;
  const lead = decision
    ? {
        icon: <Gavel size={16} aria-hidden="true" />,
        eyebrow: ["Decision", decision.actor, decisionDay(decision.at)]
          .filter(Boolean)
          .join(" · "),
        title: decision.label,
        tone: decision.tone,
      }
    : suggestion
      ? {
          icon: <Sparkles size={16} aria-hidden="true" />,
          eyebrow: "AI suggestion · not a decision",
          title: suggestion.label,
          tone: suggestion.tone,
        }
      : {
          icon: <Sparkles size={16} aria-hidden="true" />,
          eyebrow: "Reviewed in Zoer",
          title: "See what was found",
          tone: "neutral" as Tone,
        };
  const matched = requirements.filter((item) => item.match);
  const met = matched.filter((item) => item.match?.tone === "success").length;
  const openTasks = tasks.filter((task) => !task.done).length;
  const extra = [
    decision && suggestion
      ? `AI suggested ${suggestion.label.toLowerCase()}`
      : "",
    openTasks ? `${openTasks} open task${openTasks === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const barTone = matched.some((item) => item.match?.tone === "danger")
    ? "danger"
    : met === requirements.length
      ? "success"
      : "warn";
  return (
    <button
      type="button"
      className="card procurement-notice__teaser"
      data-tone={lead.tone}
      onClick={onOpen}
      aria-label={`Open the review: ${lead.title}`}
    >
      <TintedIconTile tone={TILE_TONES[lead.tone]} size="md">
        {lead.icon}
      </TintedIconTile>
      <span className="procurement-notice__teaser-body">
        <span className="procurement-notice__teaser-eyebrow">
          {lead.eyebrow}
        </span>
        <span className="procurement-notice__teaser-title">{lead.title}</span>
        {requirements.length > 0 && (
          <span className="procurement-notice__teaser-progress">
            {matched.length > 0 && (
              <Progress
                value={(met / requirements.length) * 100}
                tone={barTone}
              />
            )}
            <span>
              {[
                matched.length > 0
                  ? `${met} of ${requirements.length} requirements met`
                  : `${requirements.length} requirements found`,
                extra,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        )}
        {extra && requirements.length === 0 && (
          <span className="procurement-notice__teaser-extra">{extra}</span>
        )}
      </span>
      <ChevronRight
        size={18}
        aria-hidden="true"
        className="procurement-notice__teaser-chevron"
      />
    </button>
  );
}

function Description({ text }: { text: string }) {
  return (
    <section className="card" aria-labelledby="procurement-notice-description">
      <div className="card__head">
        <h2 className="card__title" id="procurement-notice-description">
          Description
        </h2>
      </div>
      <div className="card__body">
        <ExpandableText
          className="procurement-notice__description"
          lines={8}
          phoneLines={5}
          label="description"
        >
          {text}
        </ExpandableText>
      </div>
    </section>
  );
}

/** Preserve unlabelled source-tab content alongside structured notice fields. */
function SourceCapture({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const source = data as {
    tabCoverage?: {
      complete: boolean;
      visited?: string[];
      failures?: { label: string; message: string }[];
    };
    sourceTabs?: { label: string; text: string; truncated?: boolean }[];
    detailNeedsRefresh?: boolean;
  };
  if (!source.tabCoverage && !source.detailNeedsRefresh) return null;
  return (
    <section className="card">
      <div className="card__body">
        <details>
          <summary>
            Source capture:{" "}
            {source.tabCoverage?.complete
              ? "all public tabs visited"
              : "incomplete / refresh needed"}
          </summary>
          <p className="small muted">
            {source.tabCoverage?.visited?.length
              ? `Visited: ${source.tabCoverage.visited.join(", ")}.`
              : "No tab coverage receipt was published."}{" "}
            Attachment links and downloaded files are tracked separately.
          </p>
          {source.tabCoverage?.failures?.map((failure, i) => (
            <p key={i}>
              {failure.label}: {failure.message}
            </p>
          ))}
          {source.sourceTabs?.map((tab, i) => (
            <details key={i}>
              <summary>
                {tab.label}
                {tab.truncated ? " (partial)" : ""}
              </summary>
              <p style={{ whiteSpace: "pre-wrap" }}>{tab.text}</p>
            </details>
          ))}
        </details>
      </div>
    </section>
  );
}
