/**
 * Shared commitment form fields + form-state utilities.
 *
 * Single source of truth for the commitment create/edit schema. Both the
 * Commitments page drawer and the global "Add commitment" popup render these
 * same fields, so the shape and parity are guaranteed. Surfaces own their own
 * form state and pass a `value` + `onChange` patch callback — this component is
 * presentational. The enum constants, the review-status label helper, the
 * dropdown-data hook, and the create/update payload builder live here too so
 * callers never re-declare them.
 */
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { Field } from "../../components/ui";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";

export const COMMITMENT_CATEGORIES = ["Contract", "Grant", "Facility", "Governance", "Privacy", "Funding", "Other"] as const;
export const COMMITMENT_CADENCES = ["Once", "Monthly", "Quarterly", "Annual", "Every 2 years", "Custom"] as const;
export const COMMITMENT_STATUSES = ["Active", "Watching", "Paused", "Closed"] as const;
export const COMMITMENT_REVIEW_STATUSES = ["NeedsReview", "Verified", "Rejected"] as const;

export function reviewStatusLabel(status?: string) {
  switch (status) {
    case "Verified": return "Verified";
    case "Rejected": return "Rejected";
    case "NeedsReview":
    default: return "Needs review";
  }
}

export type CommitmentFormValue = {
  title: string;
  requirement: string;
  category: string;
  status: string;
  reviewStatus: string;
  confidence: number | "";
  sourceDocumentId: string;
  sourceExcerpt: string;
  sourceLabel: string;
  counterparty: string;
  cadence: string;
  nextDueDate: string;
  noticeLeadDays: number | "";
  dueDateBasis: string;
  owner: string;
  uncertaintyNote: string;
  notes: string;
};

export type CommitmentFormInitialValues = Partial<CommitmentFormValue>;

/** Create-time defaults. Provided values win (nullish-coalesced), so this also
 * seeds partial initial values passed by a quick-create caller. */
export function makeCommitmentFormDefaults(initial?: CommitmentFormInitialValues): CommitmentFormValue {
  return {
    title: initial?.title ?? "",
    requirement: initial?.requirement ?? "",
    category: initial?.category ?? "Contract",
    status: initial?.status ?? "Active",
    reviewStatus: initial?.reviewStatus ?? "NeedsReview",
    confidence: initial?.confidence ?? "",
    sourceDocumentId: initial?.sourceDocumentId ?? "",
    sourceExcerpt: initial?.sourceExcerpt ?? "",
    sourceLabel: initial?.sourceLabel ?? "",
    counterparty: initial?.counterparty ?? "",
    cadence: initial?.cadence ?? "Annual",
    nextDueDate: initial?.nextDueDate ?? new Date().toISOString().slice(0, 10),
    noticeLeadDays: initial?.noticeLeadDays ?? 30,
    dueDateBasis: initial?.dueDateBasis ?? "",
    owner: initial?.owner ?? "",
    uncertaintyNote: initial?.uncertaintyNote ?? "",
    notes: initial?.notes ?? "",
  };
}

/** Map an existing commitment row to editable form values. Unlike the create
 * defaults, empty fields stay empty (no "today"/"30" seeding on edit). */
export function commitmentFormFromRow(row: any): CommitmentFormValue {
  return {
    title: row.title ?? "",
    requirement: row.requirement ?? "",
    category: row.category ?? "Contract",
    status: row.status ?? "Active",
    reviewStatus: row.reviewStatus ?? "NeedsReview",
    confidence: row.confidence ?? "",
    sourceDocumentId: row.sourceDocumentId ?? "",
    sourceExcerpt: row.sourceExcerpt ?? "",
    sourceLabel: row.sourceLabel ?? "",
    counterparty: row.counterparty ?? "",
    cadence: row.cadence ?? "Annual",
    nextDueDate: row.nextDueDate ?? "",
    noticeLeadDays: row.noticeLeadDays ?? "",
    dueDateBasis: row.dueDateBasis ?? "",
    owner: row.owner ?? "",
    uncertaintyNote: row.uncertaintyNote ?? "",
    notes: row.notes ?? "",
  };
}

function stripEmpty<T extends Record<string, any>>(value: T) {
  const out: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === "" || entry == null) continue;
    out[key] = entry;
  }
  return out as T;
}

/** Build the create/update payload (drops empty strings/nullish fields). */
export function commitmentPayload(form: CommitmentFormValue) {
  return stripEmpty({
    title: form.title.trim(),
    category: form.category,
    sourceDocumentId: form.sourceDocumentId,
    sourceLabel: form.sourceLabel,
    sourceExcerpt: form.sourceExcerpt,
    counterparty: form.counterparty,
    requirement: form.requirement.trim(),
    cadence: form.cadence,
    nextDueDate: form.nextDueDate,
    dueDateBasis: form.dueDateBasis,
    noticeLeadDays: form.noticeLeadDays === "" ? undefined : form.noticeLeadDays,
    owner: form.owner,
    status: form.status,
    reviewStatus: form.reviewStatus,
    confidence: form.confidence === "" ? undefined : form.confidence,
    uncertaintyNote: form.uncertaintyNote,
    notes: form.notes,
  });
}

export type CommitmentFormData = {
  documents: any[] | undefined;
};

/** Load every dropdown source the commitment form needs. Accepts a nullable
 * societyId so callers can call it above an early-return without violating hook
 * ordering. */
export function useCommitmentFormData(societyId: Id<"societies"> | null | undefined): CommitmentFormData {
  const args = societyId ? { societyId } : "skip";
  const documents = useQuery(api.documents.list, args);
  return { documents };
}

export function CommitmentFormFields({
  value,
  onChange,
  data,
  autoFocusTitle = false,
}: {
  value: CommitmentFormValue;
  onChange: (patch: Partial<CommitmentFormValue>) => void;
  data: CommitmentFormData;
  autoFocusTitle?: boolean;
}) {
  const documents = data.documents ?? [];
  return (
    <div>
      <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 0, marginBottom: 12 }}>
        Use a commitment for promises made to an external party. Internal work belongs in Tasks; dates set by law or regulation belong in Deadlines.
      </p>
      <Field label="Title" required>
        <input className="input" autoFocus={autoFocusTitle} value={value.title} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>
      <Field label="Requirement" required hint="What the contract, policy, grant, or agreement requires the organization to do.">
        <MarkdownEditor rows={4} value={value.requirement} onChange={(markdown) => onChange({ requirement: markdown })} />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Category">
          <Select value={value.category} onChange={(v) => onChange({ category: v })} options={COMMITMENT_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Status">
          <Select value={value.status} onChange={(v) => onChange({ status: v })} options={COMMITMENT_STATUSES.map((s) => ({ value: s, label: s }))} />
        </Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Source review">
          <Select value={value.reviewStatus} onChange={(v) => onChange({ reviewStatus: v })} options={COMMITMENT_REVIEW_STATUSES.map((s) => ({ value: s, label: reviewStatusLabel(s) }))} />
        </Field>
        <Field label="Confidence">
          <input
            className="input"
            type="number"
            min={0}
            max={100}
            value={value.confidence === "" || value.confidence == null ? "" : Math.round(value.confidence * 100)}
            onChange={(e) => onChange({ confidence: e.target.value === "" ? "" : Number(e.target.value) / 100 })}
          />
        </Field>
      </div>
      <Field label="Source document">
        <Select
          value={value.sourceDocumentId}
          onChange={(v) => onChange({ sourceDocumentId: v })}
          clearable
          searchable
          options={documents.map((doc: any) => ({ value: String(doc._id), label: doc.title, hint: doc.category }))}
        />
      </Field>
      <Field label="Source excerpt" hint="Clause or paragraph text that created this obligation.">
        <MarkdownEditor rows={4} value={value.sourceExcerpt} onChange={(markdown) => onChange({ sourceExcerpt: markdown })} />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Source label">
          <input className="input" value={value.sourceLabel} placeholder="Clause 8, Schedule B, award letter..." onChange={(e) => onChange({ sourceLabel: e.target.value })} />
        </Field>
        <Field label="Counterparty">
          <input className="input" value={value.counterparty} placeholder="Landlord, funder, ministry..." onChange={(e) => onChange({ counterparty: e.target.value })} />
        </Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Cadence">
          <Select value={value.cadence} onChange={(v) => onChange({ cadence: v })} options={COMMITMENT_CADENCES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Next due">
          <DatePicker value={value.nextDueDate} onChange={(v) => onChange({ nextDueDate: v })} />
        </Field>
        <Field label="Lead time">
          <input
            className="input"
            type="number"
            min={0}
            value={value.noticeLeadDays === "" ? "" : value.noticeLeadDays}
            onChange={(e) => onChange({ noticeLeadDays: e.target.value === "" ? "" : Number(e.target.value) })}
          />
        </Field>
      </div>
      <Field label="Due date basis">
        <input className="input" value={value.dueDateBasis} placeholder="Annual anniversary, fiscal year end, fixed contract date..." onChange={(e) => onChange({ dueDateBasis: e.target.value })} />
      </Field>
      <Field label="Owner">
        <input className="input" value={value.owner} onChange={(e) => onChange({ owner: e.target.value })} />
      </Field>
      <Field label="Uncertainty or review note">
        <MarkdownEditor rows={4} value={value.uncertaintyNote} onChange={(markdown) => onChange({ uncertaintyNote: markdown })} />
      </Field>
      <Field label="Notes">
        <MarkdownEditor rows={4} value={value.notes} onChange={(markdown) => onChange({ notes: markdown })} />
      </Field>
    </div>
  );
}
