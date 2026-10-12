import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { useToast } from "../../components/Toast";
import { CitationBadge } from "../../components/CitationTooltip";
import {
  TABLE1_INCORPORATION,
  TABLE1_VERSIONS,
  articlesApplyTo,
  operativeArticlesOf,
  operativeArticlesProblems,
  resolveOperativeArticles,
  type OperativeArticles,
} from "../../../shared/operativeArticles";

type Tri = "" | "yes" | "no";
type Draft = {
  base: "" | "bc_table_1" | "custom";
  table1Version: string;
  table1Incorporation: string;
  adoptedOn: string;
  customParts: Array<{ part: string; title: string }>;
  noticeMinDays: string;
  specialMajority: string;
  quorumPeople: string;
  quorumNumerator: string;
  quorumDenominator: string;
  boardQuorumType: string;
  boardQuorumValue: string;
  chairCastingVote: Tri;
  transferConsentRequired: Tri;
  electronicParticipationRestricted: Tri;
  directorIndemnity: string;
  officerIndemnity: string;
  sourceDocumentId: string;
  notes: string;
};

const tri = (value: boolean | undefined): Tri => (value === true ? "yes" : value === false ? "no" : "");
const fromTri = (value: Tri) => (value === "yes" ? true : value === "no" ? false : undefined);
const num = (value: string) => (value.trim() === "" ? undefined : Number(value));

function draftFrom(record: OperativeArticles | undefined): Draft {
  return {
    base: record?.base ?? "",
    table1Version: record?.table1Version ?? "",
    table1Incorporation: record?.table1Incorporation ?? "",
    adoptedOn: record?.adoptedOn ?? "",
    customParts: record?.customParts ?? [],
    noticeMinDays: record?.noticeMinDays?.toString() ?? "",
    specialMajority: record?.specialMajority ?? "",
    quorumPeople: record?.shareholderQuorum?.people?.toString() ?? "",
    quorumNumerator: record?.shareholderQuorum?.minVotingSharesNumerator?.toString() ?? "",
    quorumDenominator: record?.shareholderQuorum?.minVotingSharesDenominator?.toString() ?? "",
    boardQuorumType: record?.boardQuorum?.quorumType ?? "",
    boardQuorumValue: record?.boardQuorum?.quorumValue?.toString() ?? "",
    chairCastingVote: tri(record?.chairCastingVote),
    transferConsentRequired: tri(record?.transferConsentRequired),
    electronicParticipationRestricted: tri(record?.electronicParticipationRestricted),
    directorIndemnity: record?.directorIndemnity ?? "",
    officerIndemnity: record?.officerIndemnity ?? "",
    sourceDocumentId: record?.sourceDocumentId ?? "",
    notes: record?.notes ?? "",
  };
}

function recordFrom(draft: Draft): OperativeArticles | null {
  if (!draft.base) return null;
  const record: OperativeArticles = { base: draft.base };
  if (draft.base === "bc_table_1") {
    if (draft.table1Version) record.table1Version = draft.table1Version as OperativeArticles["table1Version"];
    if (draft.table1Incorporation) record.table1Incorporation = draft.table1Incorporation as OperativeArticles["table1Incorporation"];
  }
  if (draft.adoptedOn) record.adoptedOn = draft.adoptedOn;
  const parts = draft.customParts.filter((part) => part.part.trim() || part.title.trim());
  if (parts.length) record.customParts = parts;
  if (num(draft.noticeMinDays) !== undefined) record.noticeMinDays = num(draft.noticeMinDays);
  if (draft.specialMajority) record.specialMajority = draft.specialMajority as OperativeArticles["specialMajority"];
  if (num(draft.quorumPeople) !== undefined) {
    record.shareholderQuorum = { people: num(draft.quorumPeople)! };
    if (num(draft.quorumNumerator) !== undefined || num(draft.quorumDenominator) !== undefined) {
      record.shareholderQuorum.minVotingSharesNumerator = num(draft.quorumNumerator);
      record.shareholderQuorum.minVotingSharesDenominator = num(draft.quorumDenominator);
    }
  }
  if (draft.boardQuorumType === "majority") record.boardQuorum = { quorumType: "majority" };
  if (draft.boardQuorumType === "fixed") record.boardQuorum = { quorumType: "fixed", quorumValue: num(draft.boardQuorumValue) };
  const flags = { chairCastingVote: fromTri(draft.chairCastingVote), transferConsentRequired: fromTri(draft.transferConsentRequired), electronicParticipationRestricted: fromTri(draft.electronicParticipationRestricted) };
  for (const [key, value] of Object.entries(flags)) if (value !== undefined) (record as any)[key] = value;
  if (draft.directorIndemnity) record.directorIndemnity = draft.directorIndemnity as OperativeArticles["directorIndemnity"];
  if (draft.officerIndemnity) record.officerIndemnity = draft.officerIndemnity as OperativeArticles["officerIndemnity"];
  if (draft.sourceDocumentId) record.sourceDocumentId = draft.sourceDocumentId;
  if (draft.notes.trim()) record.notes = draft.notes.trim();
  return record;
}

const TRI_OPTIONS = (unset: string) => [
  { value: "", label: unset },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/**
 * Corporation settings: which articles a BC company adopted and the article
 * provisions that change statutory defaults. Shown only for BC companies.
 */
export function OperativeArticlesSettings({ society, canWrite }: { society: Record<string, any>; canWrite: boolean }) {
  const toast = useToast();
  const save = useMutation(api.corporationSettings.updateOperativeArticles);
  const documents = useQuery(api.documents.list, articlesApplyTo(society) ? { societyId: society._id } : "skip") as
    Array<{ _id: string; title?: string; fileName?: string }> | undefined;
  const stored = operativeArticlesOf(society);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(stored));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(draftFrom(operativeArticlesOf(society))); }, [society._id, society.operativeArticles?.recordedAtISO]);
  const record = useMemo(() => recordFrom(draft), [draft]);
  const preview = useMemo(() => record ? resolveOperativeArticles({ ...society, operativeArticles: record }) : null, [record, society]);
  if (!articlesApplyTo(society)) return null;
  const table1 = draft.base === "bc_table_1";
  const unset = table1 ? "Not stated (Table 1 applies)" : "Not stated (statutory default)";
  const problems = record ? operativeArticlesProblems(record, society) : [];
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const onSave = async () => {
    if (!canWrite || busy || problems.length) return;
    setBusy(true);
    try {
      await save({ societyId: society._id, operativeArticles: record as any });
      toast.success(record ? "Articles recorded" : "Articles record cleared");
    } catch (error) {
      toast.error("Could not save the articles", error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  return (
    <section className="card settings-section" aria-label="Articles">
      <h2 className="settings-section__title">Articles</h2>
      <p className="settings-section__hint">
        Record the articles the company adopted. Table 1 rules apply only when you record Table 1 and its version; nothing is assumed from silence. The signed articles stay authoritative.
        {" "}<CitationBadge citationId="BC-BCA-TABLE1-ARTICLES" />
      </p>
      <div className="settings-section__row settings-section__row--pair">
        <Field label="Articles base">
          <Select value={draft.base} onChange={(value) => set({ base: value as Draft["base"] })}
            options={[{ value: "", label: "Not recorded" }, { value: "bc_table_1", label: "Table 1 (prescribed articles)" }, { value: "custom", label: "Custom articles" }]} />
        </Field>
        <Field label="Adopted on">
          <DatePicker value={draft.adoptedOn} onChange={(value) => set({ adoptedOn: value })} />
        </Field>
      </div>
      {table1 && (
        <div className="settings-section__row settings-section__row--pair">
          <Field label="Table 1 version adopted" hint="The version in force when the company adopted it.">
            <Select value={draft.table1Version} onChange={(value) => set({ table1Version: value })}
              options={[{ value: "", label: "Choose a version" }, ...TABLE1_VERSIONS.map((item) => ({ value: item.value, label: item.label }))]} />
          </Field>
          <Field label="How Table 1 forms part of the articles">
            <Select value={draft.table1Incorporation} onChange={(value) => set({ table1Incorporation: value })}
              options={[{ value: "", label: "Not recorded" }, ...TABLE1_INCORPORATION.map((item) => ({ value: item.value, label: item.label }))]} />
          </Field>
        </div>
      )}
      {draft.base && (
        <>
          <h3 className="settings-section__title">Custom Parts</h3>
          {draft.customParts.map((part, index) => (
            <div key={index} className="settings-section__row settings-section__row--action">
              <Field label="Part">
                <input className="input" value={part.part} placeholder="Parts 21-23"
                  onChange={(e) => set({ customParts: draft.customParts.map((row, i) => i === index ? { ...row, part: e.target.value } : row) })} />
              </Field>
              <Field label="Covers">
                <input className="input" value={part.title} placeholder="Class A/B/C special rights and restrictions"
                  onChange={(e) => set({ customParts: draft.customParts.map((row, i) => i === index ? { ...row, title: e.target.value } : row) })} />
              </Field>
              <button type="button" className="btn btn--sm" onClick={() => set({ customParts: draft.customParts.filter((_, i) => i !== index) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn--sm" onClick={() => set({ customParts: [...draft.customParts, { part: "", title: "" }] })}>Add a custom Part</button>

          <h3 className="settings-section__title">Provisions that differ from {table1 ? "Table 1" : "the Act"}</h3>
          <p className="settings-section__hint">Leave a field blank when the articles do not change it.</p>
          <div className="settings-section__row settings-section__row--pair">
            <Field label="Shareholder meeting notice (days)" hint="A non-public company's articles may set 10 days or more.">
              <input className="input" type="number" min={10} max={60} value={draft.noticeMinDays} onChange={(e) => set({ noticeMinDays: e.target.value })} />
            </Field>
            <Field label="Special majority">
              <Select value={draft.specialMajority} onChange={(value) => set({ specialMajority: value })}
                options={[{ value: "", label: "Not stated (two-thirds)" }, { value: "two_thirds", label: "Two-thirds" }, { value: "three_quarters", label: "Three-quarters" }]} />
            </Field>
          </div>
          <div className="settings-section__row">
            <Field label="Shareholder quorum (persons)">
              <input className="input" type="number" min={1} value={draft.quorumPeople} onChange={(e) => set({ quorumPeople: e.target.value })} />
            </Field>
            <Field label="Holding at least (numerator)" hint="For 1/20 of voting shares, enter 1 and 20.">
              <input className="input" type="number" min={1} value={draft.quorumNumerator} onChange={(e) => set({ quorumNumerator: e.target.value })} />
            </Field>
            <Field label="of voting shares (denominator)">
              <input className="input" type="number" min={1} value={draft.quorumDenominator} onChange={(e) => set({ quorumDenominator: e.target.value })} />
            </Field>
          </div>
          <div className="settings-section__row settings-section__row--pair">
            <Field label="Board quorum">
              <Select value={draft.boardQuorumType} onChange={(value) => set({ boardQuorumType: value })}
                options={[{ value: "", label: table1 ? "Not stated (majority under Table 1)" : "Not stated" }, { value: "majority", label: "Majority of directors" }, { value: "fixed", label: "Fixed number of directors" }]} />
            </Field>
            {draft.boardQuorumType === "fixed" && (
              <Field label="Directors needed">
                <input className="input" type="number" min={1} value={draft.boardQuorumValue} onChange={(e) => set({ boardQuorumValue: e.target.value })} />
              </Field>
            )}
          </div>
          <div className="settings-section__row">
            <Field label="Chair has a casting vote">
              <Select value={draft.chairCastingVote} onChange={(value) => set({ chairCastingVote: value as Tri })} options={TRI_OPTIONS(unset)} />
            </Field>
            <Field label="Share transfers need director consent">
              <Select value={draft.transferConsentRequired} onChange={(value) => set({ transferConsentRequired: value as Tri })} options={TRI_OPTIONS(unset)} />
            </Field>
            <Field label="Articles restrict electronic participation">
              <Select value={draft.electronicParticipationRestricted} onChange={(value) => set({ electronicParticipationRestricted: value as Tri })} options={TRI_OPTIONS("Not stated (allowed by the Act)")} />
            </Field>
          </div>
          <h3 className="settings-section__title">Indemnity <CitationBadge citationId="BC-BCA-INDEMNITY" /></h3>
          <div className="settings-section__row settings-section__row--pair">
            <Field label="Director indemnity" hint="Mandatory: the articles require the company to indemnify. Permissive: the company may indemnify.">
              <Select value={draft.directorIndemnity} onChange={(value) => set({ directorIndemnity: value })}
                options={[{ value: "", label: table1 ? "Not stated (mandatory under Table 1)" : "Not stated" }, { value: "mandatory", label: "Mandatory" }, { value: "permissive", label: "Permissive" }]} />
            </Field>
            <Field label="Officer indemnity">
              <Select value={draft.officerIndemnity} onChange={(value) => set({ officerIndemnity: value })}
                options={[{ value: "", label: "Not stated" }, { value: "mandatory", label: "Mandatory" }, { value: "permissive", label: "Permissive" }]} />
            </Field>
          </div>
          <Field label="Signed articles document">
            <Select value={draft.sourceDocumentId} onChange={(value) => set({ sourceDocumentId: value })} searchable
              options={[{ value: "", label: "Not linked" }, ...(documents ?? []).map((doc) => ({ value: String(doc._id), label: doc.title || doc.fileName || "Untitled document" }))]} />
          </Field>
          <Field label="Notes">
            <input className="input" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </>
      )}
      {preview && (
        <ul className="settings-deadlines" aria-label="Rules from the recorded articles">
          <li className="settings-deadlines__item"><span className="settings-deadlines__title">{preview.label}</span></li>
          <li className="settings-deadlines__item"><span className="settings-deadlines__title">Shareholder quorum: {preview.shareholderQuorum.value.people} persons{preview.shareholderQuorum.value.numerator ? ` holding at least ${preview.shareholderQuorum.value.numerator}/${preview.shareholderQuorum.value.denominator} of the voting shares` : ""}</span><span className="settings-deadlines__basis">{preview.shareholderQuorum.citation}</span></li>
          {preview.boardQuorum && <li className="settings-deadlines__item"><span className="settings-deadlines__title">Board quorum: {preview.boardQuorum.value.quorumType === "majority" ? "majority of directors (1 for a sole director)" : `${preview.boardQuorum.value.quorumValue} directors`}</span><span className="settings-deadlines__basis">{preview.boardQuorum.citation}</span></li>}
          <li className="settings-deadlines__item"><span className="settings-deadlines__title">Notice: at least {preview.noticeMinDays.value} days</span><span className="settings-deadlines__basis">{preview.noticeMinDays.citation}</span></li>
          <li className="settings-deadlines__item"><span className="settings-deadlines__title">Share transfers {preview.transferConsentRequired.value ? "need" : "do not need"} director consent</span><span className="settings-deadlines__basis">{preview.transferConsentRequired.citation}</span></li>
          {preview.directorIndemnity && <li className="settings-deadlines__item"><span className="settings-deadlines__title">Director indemnity: {preview.directorIndemnity.value}</span><span className="settings-deadlines__basis">{preview.directorIndemnity.citation}; limits in BCA s. 163</span></li>}
          {preview.warnings.map((warning) => <li key={warning} className="settings-deadlines__item"><span className="settings-deadlines__basis">{warning}</span></li>)}
        </ul>
      )}
      {problems.length > 0 && <p className="settings-section__hint" role="alert">{problems.join(" ")}</p>}
      <div className="settings-section__row settings-section__row--action">
        <button type="button" className="btn btn--sm" disabled={!canWrite || busy || problems.length > 0 || (!record && !stored)} onClick={onSave}>
          {busy ? "Saving…" : record ? "Save articles" : "Clear articles record"}
        </button>
      </div>
    </section>
  );
}
