import type { ReactNode } from "react";
import { Badge, type ToneVariant } from "@/components/ui";

/**
 * Types, status badges and small layout pieces shared by the person profile
 * (/app/people-directory/:id) and people and source history pages.
 */

/* --------------------------------- types --------------------------------- */

export type NameCandidate = { id: string; name: string; reason?: string };
export type HistoricalState = { state: string; values: Array<{ value: string; scope: string }> };
export type HistoricalSnapshot = { role: HistoricalState; affiliation: HistoricalState };

/** A name found in a source record (personHistory:overview / profile). */
export type Occurrence = {
  _id: string;
  societyId: string;
  personName: string;
  context: string;
  observedDate?: string;
  matchStatus: string;
  roleTitle?: string;
  affiliation?: string;
  notes?: string;
  href?: string;
  sourceUrl: string;
  sourceReference: string;
  personId?: string;
  candidates?: NameCandidate[];
  namedPeople?: NameCandidate[];
  historical?: HistoricalSnapshot | null;
};

export type OverviewPerson = { _id: string; fullName: string; aliases?: string[]; occurrences: number; unreviewed: number };
export type Overview = { people: OverviewPerson[]; occurrences: Occurrence[] };

export type HistoryEvent = {
  _id: string;
  kind: string;
  title?: string;
  value?: string;
  roleTitle?: string;
  affiliation?: string;
  scope?: string;
  effectiveDate: string;
  endDate?: string;
  transition?: string;
  details?: string;
  reviewStatus: string;
  sourceUrl?: string;
  sourceReference?: string;
  supersedesEventId?: string;
  testOnlyAssumption?: boolean;
  derived?: boolean;
  href?: string;
  meetingId?: string;
  documentId?: string;
};

export type ContactPoint = {
  _id: string;
  kind: string;
  value: string;
  observedDate: string;
  reviewStatus: string;
  testOnlyAssumption?: boolean;
  sourceUrl: string;
  sourceReference: string;
};

export type RegisterLink = {
  _id: string;
  recordTable: "members" | "directors";
  href: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  membershipClass?: string;
  status?: string;
  termStart?: string;
  joinedAt?: string;
  termEnd?: string;
  leftAt?: string;
  notes?: string;
};

export type MergeRow = {
  _id: string;
  createdAtISO: string;
  mergedName: string;
  survivorId: string;
  survivorName: string;
  movedReferences: number;
  status: string;
};

export type ProfilePerson = { _id: string; fullName: string; aliases?: string[] };
export type FoundProfile = {
  notFound?: false;
  person: ProfilePerson;
  mergedInto?: { _id: string; fullName: string };
  registers: RegisterLink[];
  contactPoints: ContactPoint[];
  events: HistoryEvent[];
  historical: HistoricalSnapshot | null;
  occurrences: Occurrence[];
};
export type ProfileResult = FoundProfile | { notFound: true };

/* ------------------------------ shared bits ------------------------------ */

export const MATCH_STATUSES: Array<{ value: string; label: string; color: string; tone: ToneVariant }> = [
  { value: "verified", label: "Confirmed", color: "green", tone: "success" },
  { value: "suggested", label: "Suggested", color: "amber", tone: "warn" },
  { value: "unresolved", label: "Unresolved", color: "amber", tone: "warn" },
  { value: "assumed", label: "Test assumption", color: "purple", tone: "warn" },
  { value: "rejected", label: "Rejected", color: "red", tone: "danger" },
  { value: "not_person", label: "Organization / heading", color: "gray", tone: "neutral" },
];

export const REVIEW_STATUSES: Array<{ value: string; label: string; color: string; tone: ToneVariant }> = [
  { value: "pending", label: "Pending", color: "amber", tone: "warn" },
  { value: "verified", label: "Verified", color: "green", tone: "success" },
  { value: "rejected", label: "Rejected", color: "red", tone: "danger" },
];

export const EVENT_KINDS = ["observation", "role", "affiliation", "appointment", "departure", "note"];
export const TRANSITIONS = ["observed", "started", "changed", "ended"];
export const CONTACT_KINDS = ["email", "phone", "address", "other"];
export const PARTIAL_DATE_HINT = "YYYY, YYYY-MM or YYYY-MM-DD";

export function MatchStatusBadge({ status }: { status: string }) {
  const option = MATCH_STATUSES.find((item) => item.value === status);
  return <Badge tone={option?.tone ?? "neutral"}>{option?.label ?? status}</Badge>;
}

export function ReviewStatusBadge({ status }: { status: string }) {
  const option = REVIEW_STATUSES.find((item) => item.value === status);
  return <Badge tone={option?.tone ?? "neutral"}>{option?.label ?? status}</Badge>;
}

export function SourceLink({ url, reference }: { url?: string; reference?: string }) {
  if (!url) return <span>{reference || "—"}</span>;
  return <a href={url} target="_blank" rel="noreferrer">{reference || "Source"}</a>;
}

export function plainOptions(values: string[]) {
  return values.map((value) => ({ value, label: value }));
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** A card head with a title, an optional count or note, and its actions at the end. */
export function CardHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card__head">
      <h2 className="card__title">{title}</h2>
      {subtitle != null && <span className="card__subtitle">{subtitle}</span>}
      {children && <div className="row" style={{ gap: 8, marginLeft: "auto" }}>{children}</div>}
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

