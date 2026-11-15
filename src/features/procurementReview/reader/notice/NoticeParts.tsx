/**
 * The notice page's smaller pieces: the status badges, the facts (as the
 * side rail's card, or as the three-fact strip phones and narrow panes open
 * with), the buyer contacts, the description, the source's other fields and
 * its capture receipt, and the links that open an organisation's page. The
 * commodities under the facts are NoticeCommodities.tsx.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Mail, MapPin, Phone } from "lucide-react";
import { Badge } from "../../../../components/ui";
import { ExpandableText } from "../../../../components/ExpandableText";
import { Tooltip } from "../../../../components/Tooltip";
import { partyCount, type NoticeContact, type NoticeModel, type NoticeParty } from "../../lib/notice";
import { BUYER_PARAM, ISSUED_FOR_PARAM, SUPPLIER_PARAM, useReaderNavigation, type PartyField } from "../routes";
import { plainClick } from "../ReaderHeader";
import { useReaderSource } from "../source";
import { NoticeCommodities } from "./NoticeCommodities";

/** Status and how long is left, with the source's own wording when the two disagree. */
export function NoticeBadges({ model }: { model: NoticeModel }) {
  const { status, deadline } = model;
  const left =
    deadline && deadline.state !== "closed" && deadline.state !== "unknown" ? (
      <Badge tone={deadline.state === "soon" || deadline.state === "today" ? "warn" : "neutral"}>
        {deadline.state === "today" ? "Closes today" : `Closes ${deadline.relative}`}
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

/** The facts an opportunity is first judged on, in one row under the header where there is no rail: Closes, Buyer, Type. */
export function FactStrip({ model }: { model: NoticeModel }) {
  const facts = ["Closes", "Buyer", "Type"]
    .map((label) => model.facts.find((fact) => fact.label === label))
    .filter((fact) => fact !== undefined);
  if (!facts.length) return null;
  return (
    <dl className="procurement-notice__strip" aria-label="Key facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.party ? <PartyLink party={fact.party} name={fact.value} /> : fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Every fact, and the commodities under them. `omit` leaves out facts shown elsewhere on the page (an award's own card). */
export function NoticeFacts({ model, omit = [] }: { model: NoticeModel; omit?: readonly string[] }) {
  const facts = model.facts.filter((fact) => !omit.includes(fact.label));
  return (
    <section className="procurement-notice__facts card" aria-label="Notice details">
      <div className="card__body">
        <dl className="procurement-notice__kv">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.party ? <PartyLink party={fact.party} name={fact.value} countKind={model.kind} /> : fact.value}</dd>
            </div>
          ))}
          <div>
            <dt>Source</dt>
            <dd>{model.source}</dd>
          </div>
        </dl>
      </div>
      {model.commodities.length > 0 && <NoticeCommodities commodities={model.commodities} />}
    </section>
  );
}

export function NoticeContacts({ model }: { model: NoticeModel }) {
  if (!model.contacts.length && !model.contactAddress) return null;
  return (
    <section className="procurement-notice__contact card" aria-labelledby="procurement-notice-contact">
      <div className="card__head">
        <h2 className="card__title" id="procurement-notice-contact">
          {model.contacts.length > 1 ? "Buyer contacts" : "Buyer contact"}
        </h2>
      </div>
      <div className="card__body col">
        {model.contacts.map((contact) => (
          <ContactPerson key={`${contact.name}|${contact.email}|${contact.phone}`} contact={contact} />
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
      {contact.name && <OneLine value={contact.name} className="procurement-notice__person-name" />}
      {contact.role && <OneLine value={contact.role} className="muted" />}
      {contact.email && <OneLine value={contact.email} href={`mailto:${contact.email}`} icon={<Mail size={13} aria-hidden="true" />} />}
      {contact.phone && (
        <OneLine value={contact.phone} href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} icon={<Phone size={13} aria-hidden="true" />} />
      )}
    </div>
  );
}

/** A value kept to one line; the full value shows in the shared tooltip only when the line is cut short. */
function OneLine({ value, href, icon, className }: { value: string; href?: string; icon?: ReactNode; className?: string }) {
  const text = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const node = text.current;
    if (!node) return;
    const check = () => setTruncated(node.scrollWidth > node.clientWidth + 1);
    check();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
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

const PARAM_OF: Record<PartyField, string> = { organization: BUYER_PARAM, issuedFor: ISSUED_FOR_PARAM, supplier: SUPPLIER_PARAM };

/**
 * A buyer, issued-for or supplier name that opens the organisation's page. It
 * is a real link, so a middle-click or a long-press opens it in a new tab.
 * With `countKind`, says how many of that kind's notices name it, once the
 * list has loaded (and only when there are others).
 */
export function PartyLink({ party, name, countKind }: { party: PartyField; name: string; countKind?: string }) {
  const { params, openParty, partyHref, pushed, back } = useReaderNavigation();
  // Opened from this organisation's own page: its link goes back there rather than opening it again.
  const fromHere = pushed && params.get(PARAM_OF[party]) === name;
  const source = useReaderSource();
  return (
    <a
      className="procurement-notice__party"
      href={partyHref(party, name)}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        if (fromHere) back();
        else openParty(party, name);
      }}
    >
      <span className="procurement-notice__party-name">{name}</span>
      {/* The list hook is newer than some sources; without it there is simply no count. */}
      {countKind && party !== "supplier" && typeof source.useList === "function" && !source.usePage && (
        <PartyCount kind={countKind} party={party} name={name} />
      )}
    </a>
  );
}

/** Read from the whole list, which only the snapshot and service readers hold (the hosted one pages it). */
function PartyCount({ kind, party, name }: { kind: string; party: NoticeParty; name: string }) {
  const list = useReaderSource().useList(kind);
  const count = useMemo(() => (list?.done ? partyCount(list.rows, party, name) : null), [list, party, name]);
  if (!count) return null;
  return (
    <small className="procurement-notice__party-count">
      {count} {kind === "award" ? "awards" : "opportunities"}
    </small>
  );
}

/**
 * Everything else about the notice, after the documents where there is no
 * rail: the facts beside the contact, then the rest. Folded on phones, where
 * the strip under the header already has the facts a decision needs.
 */
export function AllDetails({ folded, facts, contacts, rest }: { folded: boolean; facts: ReactNode; contacts: ReactNode; rest: ReactNode }) {
  if (folded)
    return (
      <details className="procurement-notice__all">
        <summary>
          <h2 className="procurement-notice__all-title">All details</h2>
          <ChevronDown size={16} aria-hidden="true" className="procurement-notice__all-chevron" />
        </summary>
        <div className="procurement-notice__all-body">
          {facts}
          {contacts}
          {rest}
        </div>
      </details>
    );
  return (
    <section className="procurement-notice__all" aria-labelledby="procurement-notice-all">
      <h2 className="procurement-notice__all-title" id="procurement-notice-all">
        All details
      </h2>
      <div className="procurement-notice__all-grid">
        {facts}
        {contacts}
      </div>
      {rest}
    </section>
  );
}

export function Description({ text }: { text: string }) {
  return (
    <section className="card" aria-labelledby="procurement-notice-description">
      <div className="card__head">
        <h2 className="card__title" id="procurement-notice-description">
          Description
        </h2>
      </div>
      <div className="card__body">
        <ExpandableText className="procurement-notice__description" lines={8} phoneLines={5} label="description">
          {text}
        </ExpandableText>
      </div>
    </section>
  );
}

export function NoticeFields({ model }: { model: NoticeModel }) {
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
            <div key={`${field.label}-${index}`} data-long={field.long || undefined}>
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

/**
 * Where the scraper ran a page's separate fields together ("…General
 * InformationOpportunity Type…"), start the next one on its own line. Only
 * after a run of lower-case letters or closing punctuation, so names like
 * "McDonald" and "iPhone" stay whole.
 */
export function readableCapture(text: string): string {
  return text.replace(/([a-z]{3}|[).:])(?=[A-Z][a-z])/g, "$1\n");
}

/**
 * The page text the scraper captured from each of the source's tabs, kept
 * for what the structured fields above don't carry (amendment history, the
 * list of addenda, delivery instructions). Folded away at the end of the
 * notice; the coverage receipt shows only when a tab couldn't be read.
 */
export function SourceCapture({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const source = data as {
    tabCoverage?: { complete: boolean; visited?: string[]; failures?: { label: string; message: string }[] };
    sourceTabs?: { label: string; text: string; truncated?: boolean }[];
    detailNeedsRefresh?: boolean;
  };
  const tabs = source.sourceTabs?.filter((tab) => tab.text.trim()) ?? [];
  const incomplete = Boolean(source.detailNeedsRefresh || (source.tabCoverage && !source.tabCoverage.complete) || source.tabCoverage?.failures?.length);
  if (!tabs.length && !incomplete) return null;
  return (
    <section className="card procurement-notice__capture">
      <div className="card__body">
        <details>
          <summary>Original page text</summary>
          {incomplete && (
            <p className="small muted">
              Some of the source's tabs couldn't be read in full, so this may be missing parts.
              {source.tabCoverage?.failures?.map((failure) => ` ${failure.label}: ${failure.message}.`).join("")}
            </p>
          )}
          {tabs.map((tab, i) => (
            <details key={i}>
              <summary>
                {tab.label}
                {tab.truncated ? " (partial)" : ""}
              </summary>
              <p className="procurement-notice__capture-text">{readableCapture(tab.text)}</p>
            </details>
          ))}
        </details>
      </div>
    </section>
  );
}
