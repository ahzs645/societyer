import { useMemo, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "@/hooks/useSociety";
import { usePermissions } from "@/hooks/usePermissions";
import { addDays, organizationTodayISO } from "@/lib/dateRanges";
import { formatDate, formatDateTime } from "@/lib/format";
import { Money } from "../Money";
import { normalizePersonKey } from "../../../shared/meetingAttendanceGrid";
import {
  ENTITY_KIND_LABEL,
  ENTITY_KIND_PERMISSION,
  entityHref,
  entityKey,
  type EntityKind,
  type EntityRef,
} from "./entityRefs";

export type PreviewTone = "neutral" | "success" | "warn" | "danger" | "info";

export type EntityPreviewData = {
  title: string;
  kindLabel: string;
  subtitle?: string;
  initials: string;
  badges: Array<{ label: string; tone: PreviewTone }>;
  facts: Array<{ label: string; value: ReactNode }>;
  related: Array<{ label: string; ref: EntityRef }>;
  /** Recent activity rows (e.g. a payee's last transactions). */
  activity?: { title: string; rows: Array<{ key: string; primary: string; secondary?: string; cents?: number }> };
  thumbnailUrl?: string;
  href: string | null;
};

export type EntityPreviewState =
  | { status: "loading"; data?: EntityPreviewData }
  | { status: "ready"; data: EntityPreviewData }
  | { status: "missing"; data?: undefined }
  | { status: "denied"; data?: undefined };

/**
 * Last resolved preview per entity, so a card opened again shows at once
 * while its live query reconnects. Keyed by workspace so nothing crosses
 * organisations.
 */
const previewCache = new Map<string, EntityPreviewData>();
const PREVIEW_CACHE_LIMIT = 200;

function remember(key: string, data: EntityPreviewData) {
  if (previewCache.has(key)) previewCache.delete(key);
  previewCache.set(key, data);
  if (previewCache.size > PREVIEW_CACHE_LIMIT) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
}

const PEOPLE_KINDS: ReadonlySet<EntityKind> = new Set(["person", "member", "director"]);
const TXN_LIMIT = 500;

/**
 * Loads what a hover card or stacked card shows for one record. It reuses
 * the list queries the pages already subscribe to (so most previews resolve
 * from the client's existing subscription) and loads nothing until a card
 * actually mounts it.
 */
export function useEntityPreview(ref: EntityRef | null): EntityPreviewState {
  const society = useSociety() as any;
  const { loaded, can } = usePermissions();
  const societyId = society?._id as string | undefined;
  const kind = ref?.kind ?? null;
  const allowed = (permission: string) => !!societyId && loaded && can(permission);
  const args = (needed: boolean) => (needed ? { societyId: societyId as any } : "skip");

  // Meetings resolve their attendees to member and director records.
  const needsPeople = !!kind && (PEOPLE_KINDS.has(kind) || kind === "meeting");
  const members = useQuery(api.members.list, args(needsPeople && allowed("members:read"))) as any[] | undefined;
  const directors = useQuery(api.directors.list, args(needsPeople && allowed("directors:read"))) as any[] | undefined;
  const people = useQuery(
    api.peopleDirectory.list,
    args(kind === "person" && !!ref?.id && allowed("members:read")),
  ) as any[] | undefined;
  const documents = useQuery(api.documents.listSummaries, args(kind === "document" && allowed("documents:read"))) as any[] | undefined;
  const meetings = useQuery(api.meetings.list, args(kind === "meeting" && allowed("meetings:read"))) as any[] | undefined;
  const transactions = useQuery(
    api.financialHub.transactions,
    kind === "counterparty" && allowed("financials:read") ? { societyId: societyId as any, limit: TXN_LIMIT } : "skip",
  ) as any[] | undefined;
  const invoiceWorkspace = useQuery(api.invoices.workspace, args(kind === "invoice" && allowed("financials:read"))) as any;
  const claims = useQuery(api.expenseReports.list, args(kind === "claim" && allowed("financials:read"))) as any[] | undefined;

  const today = organizationTodayISO(society ?? null);
  const cacheKey = ref ? `${societyId ?? "none"}|${entityKey(ref)}` : null;

  const built = useMemo((): EntityPreviewData | null | undefined => {
    if (!ref) return null;
    switch (ref.kind) {
      case "member":
        return members === undefined ? undefined : buildMember(ref, members, directors ?? []);
      case "director":
        return directors === undefined ? undefined : buildDirector(ref, directors, members ?? []);
      case "person":
        if (members === undefined && directors === undefined) return undefined;
        if (ref.id && people === undefined && allowed("members:read")) return undefined;
        return buildPerson(ref, members ?? [], directors ?? [], people ?? []);
      case "document":
        return documents === undefined ? undefined : buildDocument(ref, documents);
      case "meeting":
        return meetings === undefined ? undefined : buildMeeting(ref, meetings, today, members ?? [], directors ?? []);
      case "counterparty":
        return transactions === undefined ? undefined : buildCounterparty(ref, transactions, today);
      case "invoice":
        return invoiceWorkspace === undefined ? undefined : buildInvoice(ref, invoiceWorkspace?.invoices ?? []);
      case "claim":
        return claims === undefined ? undefined : buildClaim(ref, claims);
      default:
        return null;
    }
    // `allowed` reads the same inputs listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.kind, ref?.id, ref?.name, members, directors, people, documents, meetings, transactions, invoiceWorkspace, claims, today, loaded]);

  if (!ref) return { status: "missing" };
  if (!loaded || !societyId) return { status: "loading", data: cacheKey ? previewCache.get(cacheKey) : undefined };
  if (!can(ENTITY_KIND_PERMISSION[ref.kind])) return { status: "denied" };
  if (built === undefined) return { status: "loading", data: cacheKey ? previewCache.get(cacheKey) : undefined };
  if (built === null) return { status: "missing" };
  if (cacheKey) remember(cacheKey, built);
  return { status: "ready", data: built };
}

/* ------------------------------ builders ------------------------------ */

function initialsOf(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

const fullName = (row: any) => [row?.firstName, row?.lastName].filter(Boolean).join(" ").trim();

/**
 * A member row and a director row describe the same person: linked by id,
 * by directory profile, or (for registers kept by hand) by the same name.
 */
function samePerson(member: any, director: any) {
  if (director.memberId) return String(director.memberId) === String(member._id);
  if (member.directoryPersonId && director.directoryPersonId) {
    return String(member.directoryPersonId) === String(director.directoryPersonId);
  }
  const key = normalizePersonKey(fullName(member));
  return !!key && key === normalizePersonKey(fullName(director));
}

const memberRole = (member: any) => `${member.membershipClass} member`;
const boardRole = (director: any) =>
  /director/i.test(String(director.position ?? "")) ? String(director.position) : `${director.position} (director)`;

function isCurrentDirector(director: any) {
  const status = String(director?.status ?? "").toLowerCase();
  return !director?.resignedAt && !["resigned", "former", "removed", "inactive", "ended"].includes(status);
}

function termText(director: any) {
  if (!director?.termStart) return "No term recorded";
  return director.termEnd
    ? `${formatDate(director.termStart)} – ${formatDate(director.termEnd)}`
    : `Since ${formatDate(director.termStart)}`;
}

function contactValue(email?: string, phone?: string): ReactNode {
  const parts = [email, phone].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

function statusTone(status: string): PreviewTone {
  const value = status.toLowerCase();
  if (/(active|approved|paid|held|current|good standing|completed|signed)/.test(value)) return "success";
  if (/(overdue|rejected|blocked|cancel|void|lapsed|resigned)/.test(value)) return "danger";
  if (/(pending|review|submitted|draft|missing|due|partial|sent|scheduled|planned)/.test(value)) return "warn";
  return "neutral";
}

function sentence(value: string) {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : text;
}

function buildMember(ref: EntityRef, members: any[], directors: any[]): EntityPreviewData | null {
  const member = members.find((row) => String(row._id) === ref.id);
  if (!member) return null;
  const name = member.memberKind === "organization" && member.organizationName ? member.organizationName : fullName(member);
  const seats = directors.filter((director) => samePerson(member, director));
  const roles = [
    memberRole(member),
    ...seats.filter(isCurrentDirector).map(boardRole),
  ];
  return {
    title: name || ref.name || "Member",
    kindLabel: ENTITY_KIND_LABEL.member,
    subtitle: roles.join(" · "),
    initials: initialsOf(name || "M"),
    badges: [
      { label: sentence(String(member.status ?? "")), tone: statusTone(String(member.status ?? "")) },
      ...(member.votingRights ? [{ label: "Voting", tone: "info" as const }] : []),
    ].filter((badge) => badge.label),
    facts: [
      { label: "Joined", value: member.joinedAt ? formatDate(member.joinedAt) : null },
      ...(member.leftAt ? [{ label: "Left", value: formatDate(member.leftAt) }] : []),
      { label: "Contact", value: contactValue(member.email, member.phone) },
      ...seats.filter(isCurrentDirector).map((director) => ({ label: "Board term", value: termText(director) })),
    ].filter((fact) => fact.value),
    related: [
      ...seats.map((director) => ({
        label: `Director · ${director.position}`,
        ref: { kind: "director" as const, id: String(director._id), name: fullName(director) },
      })),
      ...(member.directoryPersonId
        ? [{ label: "Directory profile", ref: { kind: "person" as const, id: String(member.directoryPersonId), name } }]
        : []),
    ],
    href: entityHref(ref),
  };
}

function buildDirector(ref: EntityRef, directors: any[], members: any[]): EntityPreviewData | null {
  const director = directors.find((row) => String(row._id) === ref.id);
  if (!director) return null;
  const name = fullName(director);
  const member = director.memberId
    ? members.find((row) => String(row._id) === String(director.memberId))
    : members.find((row) => samePerson(row, director));
  return {
    title: name || ref.name || "Director",
    kindLabel: ENTITY_KIND_LABEL.director,
    subtitle: director.position,
    initials: initialsOf(name || "D"),
    badges: [
      { label: sentence(String(director.status ?? "")), tone: statusTone(String(director.status ?? "")) },
      ...(director.consentOnFile ? [] : [{ label: "No consent on file", tone: "warn" as const }]),
    ].filter((badge) => badge.label),
    facts: [
      { label: "Term", value: termText(director) },
      ...(director.resignedAt ? [{ label: "Resigned", value: formatDate(director.resignedAt) }] : []),
      { label: "Contact", value: contactValue(director.email, member?.phone) },
      { label: "Membership", value: member ? `${member.membershipClass} member` : null },
    ].filter((fact) => fact.value),
    related: [
      ...(member
        ? [{ label: "Member record", ref: { kind: "member" as const, id: String(member._id), name: fullName(member) } }]
        : []),
      ...(director.directoryPersonId
        ? [{ label: "Directory profile", ref: { kind: "person" as const, id: String(director.directoryPersonId), name } }]
        : []),
    ],
    href: entityHref(ref),
  };
}

function buildPerson(ref: EntityRef, members: any[], directors: any[], people: any[]): EntityPreviewData | null {
  const profile = ref.id ? people.find((row) => String(row._id) === ref.id) : undefined;
  const names = new Set<string>();
  const addName = (value: unknown) => {
    const key = normalizePersonKey(value);
    if (key) names.add(key);
  };
  addName(profile?.fullName ?? ref.name);
  for (const alias of profile?.aliases ?? []) addName(alias);
  const matches = (row: any) =>
    (ref.id && String(row.directoryPersonId ?? "") === ref.id) ||
    names.has(normalizePersonKey(fullName(row))) ||
    (row.aliases ?? []).some((alias: string) => names.has(normalizePersonKey(alias)));
  const memberRows = members.filter(matches);
  const directorRows = directors.filter(matches);
  if (!profile && memberRows.length === 0 && directorRows.length === 0) {
    if (!ref.name) return null;
    return {
      title: ref.name,
      kindLabel: ENTITY_KIND_LABEL.person,
      subtitle: "Not linked to a member or director",
      initials: initialsOf(ref.name),
      badges: [],
      facts: [],
      related: [],
      href: null,
    };
  }
  const name = profile?.fullName ?? (memberRows[0] ? fullName(memberRows[0]) : directorRows[0] ? fullName(directorRows[0]) : ref.name ?? "");
  const currentSeats = directorRows.filter(isCurrentDirector);
  const roles = [...currentSeats.map(boardRole), ...memberRows.map(memberRole)];
  const email = memberRows.find((row) => row.email)?.email ?? directorRows.find((row) => row.email)?.email;
  const phone = memberRows.find((row) => row.phone)?.phone;
  return {
    title: name || "Person",
    kindLabel: ENTITY_KIND_LABEL.person,
    subtitle: roles.length ? roles.join(" · ") : "No current roles",
    initials: initialsOf(name || "P"),
    badges: currentSeats.length ? [{ label: "On the board", tone: "info" }] : [],
    facts: [
      { label: "Contact", value: contactValue(email, phone) },
      ...currentSeats.map((director) => ({ label: `${director.position} term`, value: termText(director) })),
      ...(currentSeats.length === 0 && directorRows.length
        ? [{ label: "Past board terms", value: String(directorRows.length) }]
        : []),
    ].filter((fact) => fact.value),
    related: [
      ...memberRows.map((member) => ({
        label: "Member record",
        ref: { kind: "member" as const, id: String(member._id), name: fullName(member) },
      })),
      ...directorRows.map((director) => ({
        label: `Director · ${director.position}`,
        ref: { kind: "director" as const, id: String(director._id), name: fullName(director) },
      })),
    ],
    href: profile ? entityHref({ kind: "person", id: String(profile._id) }) : memberRows[0] ? entityHref({ kind: "member", id: String(memberRows[0]._id) }) : null,
  };
}

const REVIEW_STATUS_LABEL: Record<string, string> = {
  none: "",
  needs_review: "Needs review",
  in_review: "In review",
  needs_signature: "Needs signature",
  transposed: "Transposed",
  approved: "Approved",
  blocked: "Blocked",
};

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildDocument(ref: EntityRef, documents: any[]): EntityPreviewData | null {
  const document = documents.find((row) => String(row._id) === ref.id);
  if (!document) return null;
  const reviewLabel = REVIEW_STATUS_LABEL[String(document.reviewStatus ?? "none")] ?? sentence(String(document.reviewStatus ?? ""));
  const file = [document.fileName, formatBytes(document.fileSizeBytes)].filter(Boolean).join(" · ");
  const isImage = typeof document.mimeType === "string" && document.mimeType.startsWith("image/");
  return {
    title: document.title || ref.name || "Document",
    kindLabel: ENTITY_KIND_LABEL.document,
    subtitle: document.category,
    initials: (document.mimeType?.split("/")[1] ?? document.category ?? "DOC").slice(0, 3).toUpperCase(),
    badges: [
      ...(reviewLabel ? [{ label: reviewLabel, tone: statusTone(reviewLabel) }] : []),
      ...(document.archivedAtISO ? [{ label: "Archived", tone: "neutral" as const }] : []),
      ...(document.flaggedForDeletion ? [{ label: "Flagged for deletion", tone: "danger" as const }] : []),
    ],
    facts: [
      { label: "Type", value: document.category },
      { label: "Date", value: document.createdAtISO ? formatDate(document.createdAtISO) : null },
      { label: "File", value: file || null },
      { label: "Tags", value: Array.isArray(document.tags) && document.tags.length ? document.tags.slice(0, 4).join(", ") : null },
    ].filter((fact) => fact.value),
    related: document.meetingId
      ? [{ label: "Meeting", ref: { kind: "meeting", id: String(document.meetingId) } }]
      : [],
    thumbnailUrl: isImage && typeof document.url === "string" ? document.url : undefined,
    href: entityHref(ref),
  };
}

function buildMeeting(
  ref: EntityRef,
  meetings: any[],
  today: string,
  members: any[],
  directors: any[],
): EntityPreviewData | null {
  const meeting = meetings.find((row) => String(row._id) === ref.id);
  if (!meeting) return null;
  const attendees = Array.isArray(meeting.attendeeIds) ? meeting.attendeeIds.length : 0;
  const quorum = typeof meeting.quorumRequired === "number" ? meeting.quorumRequired : null;
  const held = /held|complete/i.test(String(meeting.status ?? "")) || String(meeting.scheduledAt ?? "").slice(0, 10) < today;
  let quorumText: string | null = null;
  const badges: EntityPreviewData["badges"] = [];
  if (meeting.status) badges.push({ label: sentence(String(meeting.status)), tone: statusTone(String(meeting.status)) });
  if (quorum !== null) {
    quorumText = held ? `${attendees} present · ${quorum} needed` : `${quorum} needed`;
    if (held && attendees > 0) {
      badges.push(attendees >= quorum ? { label: "Quorum met", tone: "success" } : { label: "Below quorum", tone: "danger" });
    }
  } else if (attendees > 0) {
    quorumText = `${attendees} present · no quorum set`;
  }
  return {
    title: meeting.title || ref.name || "Meeting",
    kindLabel: ENTITY_KIND_LABEL.meeting,
    subtitle: meeting.type,
    initials: String(meeting.type || "MT").slice(0, 2).toUpperCase(),
    badges,
    facts: [
      { label: "Date", value: meeting.scheduledAt ? formatDateTime(meeting.scheduledAt) : null },
      { label: "Where", value: meeting.electronic ? (meeting.location ? `${meeting.location} and online` : "Online") : meeting.location ?? null },
      { label: "Quorum", value: quorumText },
    ].filter((fact) => fact.value),
    related: attendeeRefs(meeting.attendeeIds, members, directors),
    href: entityHref(ref),
  };
}

const MAX_ATTENDEE_LINKS = 8;

function attendeeRefs(ids: unknown, members: any[], directors: any[]): EntityPreviewData["related"] {
  if (!Array.isArray(ids)) return [];
  const related: EntityPreviewData["related"] = [];
  for (const id of ids.slice(0, MAX_ATTENDEE_LINKS)) {
    const director = directors.find((row) => String(row._id) === String(id));
    if (director) {
      related.push({ label: "Attendee", ref: { kind: "director", id: String(director._id), name: fullName(director) } });
      continue;
    }
    const member = members.find((row) => String(row._id) === String(id));
    if (member) related.push({ label: "Attendee", ref: { kind: "member", id: String(member._id), name: fullName(member) } });
  }
  return related;
}

function buildCounterparty(ref: EntityRef, transactions: any[], today: string): EntityPreviewData | null {
  const key = normalizePersonKey(ref.name);
  if (!key) return null;
  const rows = transactions
    .filter((row) => normalizePersonKey(row.counterparty) === key)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const since = addDays(today, -365);
  let inCents = 0;
  let outCents = 0;
  let count = 0;
  for (const row of rows) {
    if (String(row.date).slice(0, 10) < since) continue;
    count += 1;
    if (row.amountCents >= 0) inCents += row.amountCents;
    else outCents += -row.amountCents;
  }
  const last = rows[0];
  return {
    title: ref.name ?? "Payee",
    kindLabel: ENTITY_KIND_LABEL.counterparty,
    subtitle: count ? `${count} transaction${count === 1 ? "" : "s"} in the last 12 months` : "No transactions in the last 12 months",
    initials: initialsOf(ref.name ?? "P"),
    badges: [],
    facts: [
      { label: "Money in (12 months)", value: <Money cents={inCents} tone={inCents ? "in" : "auto"} /> },
      { label: "Money out (12 months)", value: <Money cents={outCents ? -outCents : 0} tone={outCents ? "out" : "auto"} /> },
      {
        label: "Last transaction",
        value: last ? (
          <span>
            {formatDate(last.date)} · <Money cents={last.amountCents} tone={last.amountCents >= 0 ? "in" : "out"} signDisplay="exceptZero" />
          </span>
        ) : "None yet",
      },
    ],
    related: [],
    activity: rows.length
      ? {
          title: "Recent transactions",
          rows: rows.slice(0, 5).map((row) => ({
            key: String(row._id),
            primary: row.description || row.category || "Transaction",
            secondary: [formatDate(row.date), row.category].filter(Boolean).join(" · "),
            cents: row.amountCents,
          })),
        }
      : undefined,
    href: entityHref(ref),
  };
}

const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  void: "Void",
  paid: "Paid",
  partially_paid: "Partly paid",
  partial: "Partly paid",
  overdue: "Overdue",
};

function buildInvoice(ref: EntityRef, invoices: any[]): EntityPreviewData | null {
  const invoice = invoices.find((row) => String(row._id) === ref.id);
  if (!invoice) return null;
  const status = String(invoice.status ?? invoice.lifecycle ?? "");
  const statusLabel = INVOICE_STATUS_LABEL[status] ?? sentence(status);
  return {
    title: `Invoice ${invoice.number}`,
    kindLabel: ENTITY_KIND_LABEL.invoice,
    subtitle: invoice.billToName,
    initials: "IN",
    badges: [
      ...(statusLabel ? [{ label: statusLabel, tone: statusTone(statusLabel) }] : []),
      ...(invoice.daysOverdue > 0 ? [{ label: `${invoice.daysOverdue} days overdue`, tone: "danger" as const }] : []),
    ],
    facts: [
      { label: "Amount", value: <Money cents={invoice.totalCents} currency={invoice.currency} /> },
      { label: "Balance", value: <Money cents={invoice.balanceCents ?? invoice.totalCents - invoice.paidCents} currency={invoice.currency} /> },
      { label: "Issued", value: invoice.issueDate ? formatDate(invoice.issueDate) : null },
      { label: "Due", value: invoice.dueDate ? formatDate(invoice.dueDate) : null },
    ].filter((fact) => fact.value),
    related: invoice.memberId
      ? [{ label: "Bill to", ref: { kind: "member", id: String(invoice.memberId), name: invoice.billToName } }]
      : [],
    href: entityHref(ref),
  };
}

function buildClaim(ref: EntityRef, claims: any[]): EntityPreviewData | null {
  const claim = claims.find((row) => String(row._id) === ref.id);
  if (!claim) return null;
  const status = String(claim.status ?? "");
  return {
    title: claim.title || ref.name || "Expense claim",
    kindLabel: ENTITY_KIND_LABEL.claim,
    subtitle: claim.claimantName ? `Claimed by ${claim.claimantName}` : undefined,
    initials: initialsOf(claim.claimantName || claim.title || "EC"),
    badges: status ? [{ label: sentence(status), tone: statusTone(status) }] : [],
    facts: [
      { label: "Amount", value: <Money cents={claim.amountCents} currency={claim.currency} /> },
      { label: "Category", value: claim.category },
      { label: "Incurred", value: claim.incurredAtISO ? formatDate(claim.incurredAtISO) : null },
      { label: "Paid", value: claim.paidAtISO ? formatDate(claim.paidAtISO) : null },
    ].filter((fact) => fact.value),
    related: claim.receiptDocumentId
      ? [{ label: "Receipt", ref: { kind: "document", id: String(claim.receiptDocumentId) } }]
      : [],
    href: entityHref(ref),
  };
}
