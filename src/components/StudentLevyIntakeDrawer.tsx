import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { PlusCircle, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { centsToDollarInput, dollarInputToCents } from "../lib/format";
import { useToast } from "./Toast";
import { Drawer, Field } from "./ui";
import { Select } from "./Select";

const COLLECTION_MODELS = [
  { value: "direct", label: "Direct" },
  { value: "third_party", label: "Third-party collector" },
  { value: "unknown", label: "Unknown" },
];

const COLLECTION_FREQUENCIES = [
  { value: "semester", label: "Semester / term" },
  { value: "annual", label: "Annual" },
  { value: "monthly", label: "Monthly" },
  { value: "one_time", label: "One-time" },
  { value: "irregular", label: "Irregular" },
  { value: "unknown", label: "Unknown" },
];

const MEMBER_DISCLOSURE_LEVELS = [
  { value: "named_members", label: "Named members" },
  { value: "aggregate_count", label: "Aggregate count" },
  { value: "aggregate_amount", label: "Aggregate amount only" },
  { value: "unknown", label: "Unknown" },
];

const FEE_INTERVALS = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Annual" },
  { value: "semester", label: "Semester / term" },
  { value: "one_time", label: "One-time" },
];

const FEE_STATUSES = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "retired", label: "Retired" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nextJanuaryOrSeptemberISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month < 9) return `${year}-09-01`;
  return `${year + 1}-01-01`;
}

function isOtenSociety(name?: string | null) {
  return /over the edge|oten/i.test(name ?? "");
}

function levyFeeRow(overrides: Record<string, any> = {}) {
  return {
    label: "Student levy",
    membershipClass: "Students",
    priceDollars: "",
    currency: "CAD",
    interval: "semester",
    effectiveFrom: todayISO(),
    effectiveTo: "",
    status: "active",
    notes: "",
    ...overrides,
  };
}

function otenFeeRows() {
  return [
    levyFeeRow({
      label: "OTEN student newspaper levy",
      membershipClass: "Undergraduate students",
      priceDollars: centsToDollarInput(1133),
      effectiveFrom: "2018-09-01",
      effectiveTo: "2019-08-31",
      status: "retired",
      notes:
        "Observed CA$11.33 per charged semester in September 2018 and January 2019. Charged semesters are January and September only; May/summer is not charged in the observed records.",
    }),
    levyFeeRow({
      label: "OTEN student newspaper levy",
      membershipClass: "Undergraduate students",
      priceDollars: centsToDollarInput(1163),
      effectiveFrom: "2019-09-01",
      effectiveTo: "2020-08-31",
      status: "retired",
      notes:
        "Observed CA$11.63 per charged semester in September 2019 and January 2020. Charged semesters are January and September only; May/summer is not charged in the observed records.",
    }),
    levyFeeRow({
      label: "OTEN student newspaper levy",
      membershipClass: "Undergraduate students",
      priceDollars: centsToDollarInput(1193),
      effectiveFrom: "2020-09-01",
      effectiveTo: "",
      status: "active",
      notes:
        "Observed CA$11.93 per charged semester from September 2020 onward whenever the fee appears. Charged semesters are January and September only; May/summer is not charged in the observed records.",
    }),
    levyFeeRow({
      label: "OTEN graduate student levy",
      membershipClass: "Graduate students",
      priceDollars: centsToDollarInput(1193),
      effectiveFrom: "2025-09-01",
      effectiveTo: "",
      status: "active",
      notes:
        "Graduate students began being charged starting September 2025. Same observed semester price as the OTEN levy: CA$11.93 per charged semester. May/summer is not charged in the observed records.",
    }),
  ];
}

function newLevyDraft(societyName?: string | null) {
  const oten = isOtenSociety(societyName);
  return {
    sourceName: oten ? "OTEN student newspaper levy" : "Student levy",
    status: "Active",
    contactName: oten ? "UNBC student-fee remittance" : "",
    email: "",
    phone: "",
    website: "",
    collectionAgentName: oten ? "University of Northern British Columbia" : "",
    collectionModel: "third_party",
    memberDisclosureLevel: "aggregate_amount",
    estimatedMemberCount: "",
    collectionFrequency: "semester",
    chargedTerms: oten ? "January, September" : "",
    excludedTerms: oten ? "May, Summer" : "",
    collectionScheduleNotes: oten ? "Graduate students are included starting September 2025." : "",
    nextExpectedCollectionDate: oten ? nextJanuaryOrSeptemberISO() : "",
    reconciliationCadence: "semester",
    expectedAnnualDollars: "",
    committedDollars: "",
    receivedToDateDollars: "",
    currency: "CAD",
    startDate: oten ? "2018-09-01" : todayISO(),
    endDate: "",
    restrictedPurpose: "",
    notes: oten
      ? "Fee is remitted by the university as an aggregate student newspaper levy; member-level list may not be available."
      : "",
    feePeriods: oten ? otenFeeRows() : [levyFeeRow()],
  };
}

function buildScheduleNotes(draft: any) {
  const pieces: string[] = [];
  if (draft.chargedTerms?.trim()) pieces.push(`Charged terms: ${draft.chargedTerms.trim()}.`);
  if (draft.excludedTerms?.trim()) pieces.push(`Excluded terms: ${draft.excludedTerms.trim()}.`);
  if (draft.collectionScheduleNotes?.trim()) pieces.push(draft.collectionScheduleNotes.trim());
  return pieces.join(" ");
}

export function StudentLevyIntakeDrawer({
  open,
  onClose,
  societyId,
  societyName,
  actingUserId,
}: {
  open: boolean;
  onClose: () => void;
  societyId: any;
  societyName?: string | null;
  actingUserId?: any;
}) {
  const [draft, setDraft] = useState<any>(() => newLevyDraft(societyName));
  const importStudentLevy = useMutation(api.fundingSources.importStudentLevy);
  const toast = useToast();

  useEffect(() => {
    if (open) setDraft(newLevyDraft(societyName));
  }, [open, societyName]);

  const updateFee = (index: number, patch: Record<string, any>) => {
    setDraft((current: any) => ({
      ...current,
      feePeriods: current.feePeriods.map((row: any, rowIndex: number) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    }));
  };

  const removeFee = (index: number) => {
    setDraft((current: any) => ({
      ...current,
      feePeriods: current.feePeriods.filter((_: any, rowIndex: number) => rowIndex !== index),
    }));
  };

  const validFeePeriods = draft.feePeriods.filter((row: any) => row.label?.trim() && row.effectiveFrom);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Student levy import"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--accent"
            disabled={!societyId || !draft.sourceName?.trim() || validFeePeriods.length === 0}
            onClick={async () => {
              const result = await importStudentLevy({
                societyId,
                sourceName: draft.sourceName,
                sourceType: "Member dues",
                status: draft.status,
                contactName: draft.contactName || undefined,
                email: draft.email || undefined,
                phone: draft.phone || undefined,
                website: draft.website || undefined,
                collectionAgentName: draft.collectionAgentName || undefined,
                collectionModel: draft.collectionModel || undefined,
                memberDisclosureLevel: draft.memberDisclosureLevel || undefined,
                estimatedMemberCount: draft.estimatedMemberCount === "" ? undefined : Number(draft.estimatedMemberCount),
                collectionFrequency: draft.collectionFrequency || undefined,
                collectionScheduleNotes: buildScheduleNotes(draft) || undefined,
                nextExpectedCollectionDate: draft.nextExpectedCollectionDate || undefined,
                reconciliationCadence: draft.reconciliationCadence || undefined,
                expectedAnnualCents: dollarInputToCents(draft.expectedAnnualDollars),
                committedCents: dollarInputToCents(draft.committedDollars),
                receivedToDateCents: dollarInputToCents(draft.receivedToDateDollars),
                currency: draft.currency || "CAD",
                startDate: draft.startDate || undefined,
                endDate: draft.endDate || undefined,
                restrictedPurpose: draft.restrictedPurpose || undefined,
                notes: draft.notes || undefined,
                feePeriods: validFeePeriods.map((row: any) => ({
                  label: row.label,
                  membershipClass: row.membershipClass || undefined,
                  priceCents: dollarInputToCents(row.priceDollars) ?? 0,
                  currency: row.currency || draft.currency || "CAD",
                  interval: row.interval,
                  effectiveFrom: row.effectiveFrom,
                  effectiveTo: row.effectiveTo || undefined,
                  status: row.status,
                  notes: row.notes || undefined,
                })),
                actingUserId,
              });
              toast.success(
                "Student levy imported",
                `${result.createdFeePeriods} fee period${result.createdFeePeriods === 1 ? "" : "s"} added, ${result.updatedFeePeriods} updated.`,
              );
              onClose();
            }}
          >
            Import levy
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Field label="Levy or source name">
          <input
            className="input"
            value={draft.sourceName}
            onChange={(event) => setDraft({ ...draft, sourceName: event.target.value })}
          />
        </Field>
        <Field label="Collection agent">
          <input
            className="input"
            placeholder="University finance office"
            value={draft.collectionAgentName}
            onChange={(event) => setDraft({ ...draft, collectionAgentName: event.target.value })}
          />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Collection model">
            <Select
              value={draft.collectionModel}
              onChange={(value) => setDraft({ ...draft, collectionModel: value })}
              options={COLLECTION_MODELS}
            />
          </Field>
          <Field label="Member disclosure">
            <Select
              value={draft.memberDisclosureLevel}
              onChange={(value) => setDraft({ ...draft, memberDisclosureLevel: value })}
              options={MEMBER_DISCLOSURE_LEVELS}
            />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Collection frequency">
            <Select
              value={draft.collectionFrequency}
              onChange={(value) => setDraft({ ...draft, collectionFrequency: value })}
              options={COLLECTION_FREQUENCIES}
            />
          </Field>
          <Field label="Next expected collection">
            <input
              className="input"
              type="date"
              value={draft.nextExpectedCollectionDate}
              onChange={(event) => setDraft({ ...draft, nextExpectedCollectionDate: event.target.value })}
            />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Charged terms">
            <input
              className="input"
              value={draft.chargedTerms}
              onChange={(event) => setDraft({ ...draft, chargedTerms: event.target.value })}
            />
          </Field>
          <Field label="Excluded terms">
            <input
              className="input"
              value={draft.excludedTerms}
              onChange={(event) => setDraft({ ...draft, excludedTerms: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Schedule notes">
          <textarea
            className="textarea"
            value={draft.collectionScheduleNotes}
            onChange={(event) => setDraft({ ...draft, collectionScheduleNotes: event.target.value })}
          />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Estimated member count">
            <input
              className="input"
              type="number"
              min="0"
              value={draft.estimatedMemberCount}
              onChange={(event) => setDraft({ ...draft, estimatedMemberCount: event.target.value })}
            />
          </Field>
          <Field label="Reconciliation cadence">
            <input
              className="input"
              value={draft.reconciliationCadence}
              onChange={(event) => setDraft({ ...draft, reconciliationCadence: event.target.value })}
            />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Field label="Expected / year">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={draft.expectedAnnualDollars}
              onChange={(event) => setDraft({ ...draft, expectedAnnualDollars: event.target.value })}
            />
          </Field>
          <Field label="Committed">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={draft.committedDollars}
              onChange={(event) => setDraft({ ...draft, committedDollars: event.target.value })}
            />
          </Field>
          <Field label="Received to date">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={draft.receivedToDateDollars}
              onChange={(event) => setDraft({ ...draft, receivedToDateDollars: event.target.value })}
            />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Start date">
            <input
              className="input"
              type="date"
              value={draft.startDate}
              onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
            />
          </Field>
          <Field label="End date">
            <input
              className="input"
              type="date"
              value={draft.endDate}
              onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            className="textarea"
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </Field>

        <div className="card" style={{ border: "1px solid var(--border)" }}>
          <div className="card__head">
            <h3 className="card__title">Fee periods</h3>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() =>
                setDraft((current: any) => ({
                  ...current,
                  feePeriods: [...current.feePeriods, levyFeeRow({ label: current.sourceName })],
                }))
              }
            >
              <PlusCircle size={12} /> Add row
            </button>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            {draft.feePeriods.map((row: any, index: number) => (
              <div key={index} style={{ borderTop: index === 0 ? undefined : "1px solid var(--border)", paddingTop: index === 0 ? 0 : 12 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <strong>Period {index + 1}</strong>
                  {draft.feePeriods.length > 1 && (
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={`Remove fee period ${index + 1}`}
                      onClick={() => removeFee(index)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <Field label="Fee label">
                  <input
                    className="input"
                    value={row.label}
                    onChange={(event) => updateFee(index, { label: event.target.value })}
                  />
                </Field>
                <Field label="Membership class">
                  <input
                    className="input"
                    value={row.membershipClass}
                    onChange={(event) => updateFee(index, { membershipClass: event.target.value })}
                  />
                </Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Price">
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.priceDollars}
                      onChange={(event) => updateFee(index, { priceDollars: event.target.value })}
                    />
                  </Field>
                  <Field label="Interval">
                    <Select
                      value={row.interval}
                      onChange={(value) => updateFee(index, { interval: value })}
                      options={FEE_INTERVALS}
                    />
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Effective from">
                    <input
                      className="input"
                      type="date"
                      value={row.effectiveFrom}
                      onChange={(event) => updateFee(index, { effectiveFrom: event.target.value })}
                    />
                  </Field>
                  <Field label="Effective to">
                    <input
                      className="input"
                      type="date"
                      value={row.effectiveTo}
                      onChange={(event) => updateFee(index, { effectiveTo: event.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Status">
                  <Select
                    value={row.status}
                    onChange={(value) => updateFee(index, { status: value })}
                    options={FEE_STATUSES}
                  />
                </Field>
                <Field label="Period notes">
                  <textarea
                    className="textarea"
                    value={row.notes}
                    onChange={(event) => updateFee(index, { notes: event.target.value })}
                  />
                </Field>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
