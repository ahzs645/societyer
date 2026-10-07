import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { describeCadenceRule, type CadenceRule } from "../../../shared/continuityRules";
import { CadenceRuleFields, cleanCadenceRule } from "../gaps/CadenceRuleFields";
import { formatDateTime } from "../../lib/format";
import { calendarDateKey } from "../../lib/calendarDates";
import { cleanQuorumRule, describeQuorumRule, quorumRuleProblems } from "../../../shared/bodyQuorum";
import { QuorumRuleFields, quorumRuleDraft, quorumRuleFromDraft, type QuorumRuleDraft } from "./QuorumRuleFields";

export const COMMITTEE_KIND_OPTIONS = [
  { value: "standing", label: "Standing committee" },
  { value: "executive", label: "Executive committee" },
  { value: "ad_hoc", label: "Ad hoc committee" },
  { value: "working_group", label: "Working group" },
  { value: "advisory", label: "Advisory committee" },
];

const PARENT_OPTIONS = [
  { value: "board", label: "Board of directors" },
  { value: "members", label: "Members" },
  { value: "committee", label: "Another committee" },
];

type MandateVersion = { id: string; effectiveFrom: string; effectiveTo?: string; title?: string; mandate?: string; quorumText?: string; notes?: string; documentId?: string; cadenceRule?: CadenceRule };

type StructureForm = {
  kind: string;
  parentBody: string;
  parentCommitteeId: string;
  hasRule: boolean;
  rule: CadenceRule;
  cadenceLabel: string;
  mandateVersions: MandateVersion[];
  quorum: QuorumRuleDraft;
};

/**
 * Committee kind, parent body, structured cadence rule and effective-dated
 * mandate / terms-of-reference versions (finding A4). The free-text cadence
 * label stays for compatibility and follows the structured rule by default.
 */
export function CommitteeStructureCard({ committee, canWrite, societyId }: { committee: any; canWrite: boolean; societyId: string }) {
  const committees = useQuery(api.committees.list, { societyId }) as any[] | undefined;
  const updateStructure = usePermissionedMutation(api.committees.updateStructure, canWrite);
  const updateCommittee = usePermissionedMutation(api.committees.update, canWrite);
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<StructureForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kindLabel = COMMITTEE_KIND_OPTIONS.find((option) => option.value === committee.kind)?.label;
  const parentLabel = committee.parentBody === "committee"
    ? committees?.find((row) => row._id === committee.parentCommitteeId)?.name ?? "Another committee"
    : PARENT_OPTIONS.find((option) => option.value === committee.parentBody)?.label;
  const versions: MandateVersion[] = committee.mandateVersions ?? [];
  // Local calendar date: a UTC date flips to tomorrow on a late evening in Vancouver.
  const today = calendarDateKey(new Date());
  const current = [...versions].reverse().find((version) => version.effectiveFrom <= today && (!version.effectiveTo || version.effectiveTo >= today));

  const openEditor = () => {
    setError(null);
    setForm({
      kind: committee.kind ?? "",
      parentBody: committee.parentBody ?? "",
      parentCommitteeId: committee.parentCommitteeId ?? "",
      hasRule: Boolean(committee.cadenceRule),
      rule: committee.cadenceRule ?? { frequency: "monthly" },
      cadenceLabel: committee.cadenceRule ? "" : committee.cadence ?? "",
      mandateVersions: versions.map((version) => ({ ...version })),
      quorum: quorumRuleDraft(committee.quorumRule),
    });
  };

  const save = async () => {
    if (!form) return;
    setError(null);
    const quorumRule = quorumRuleFromDraft(form.quorum);
    const quorumProblems = quorumRuleProblems(quorumRule);
    if (quorumProblems.length) {
      setError(`Quorum: ${quorumProblems.join(" ")}`);
      return;
    }
    const missingStart = form.mandateVersions.findIndex((version) => !version.effectiveFrom);
    if (missingStart >= 0) {
      setError(`Mandate version ${missingStart + 1} needs an effective-from date.`);
      return;
    }
    try {
      const nextQuorum = quorumRule ? cleanQuorumRule(quorumRule) : null;
      if (JSON.stringify(nextQuorum) !== JSON.stringify(committee.quorumRule ? cleanQuorumRule(committee.quorumRule) : null)) {
        await updateCommittee({ id: committee._id, patch: nextQuorum ? { quorumRule: nextQuorum } : { clearQuorumRule: true } });
      }
      await updateStructure({
        id: committee._id,
        kind: form.kind || null,
        parentBody: form.parentBody || null,
        parentCommitteeId: form.parentBody === "committee" && form.parentCommitteeId ? form.parentCommitteeId : null,
        cadenceRule: form.hasRule ? cleanCadenceRule(form.rule) : null,
        // With a structured rule the label follows the rule; a stale label ("Unknown") must not be sent back.
        ...(!form.hasRule && form.cadenceLabel.trim() ? { cadenceLabel: form.cadenceLabel.trim() } : {}),
        mandateVersions: form.mandateVersions.map((version) => {
          const out: MandateVersion = { id: version.id, effectiveFrom: version.effectiveFrom };
          if (version.effectiveTo) out.effectiveTo = version.effectiveTo;
          if (version.title?.trim()) out.title = version.title.trim();
          if (version.mandate?.trim()) out.mandate = version.mandate.trim();
          if (version.quorumText?.trim()) out.quorumText = version.quorumText.trim();
          if (version.notes?.trim()) out.notes = version.notes.trim();
          if (version.documentId) out.documentId = version.documentId;
          if (version.cadenceRule) out.cadenceRule = cleanCadenceRule(version.cadenceRule);
          return out;
        }),
      });
      toast.success("Committee structure saved");
      setForm(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    }
  };

  const patchVersion = (index: number, patch: Partial<MandateVersion>) => {
    if (!form) return;
    const next = form.mandateVersions.map((version, i) => (i === index ? { ...version, ...patch } : version));
    setForm({ ...form, mandateVersions: next });
  };

  return (
    <div className="card">
      <div className="card__head">
        <h2 className="card__title">Body, cadence and mandate</h2>
        {canWrite && (
          <button type="button" className="btn btn--sm" style={{ marginLeft: "auto" }} onClick={openEditor}>
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>
      <div className="card__body col" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Badge tone="accent">{!committee.cadence || committee.cadence === "Unknown" ? "Cadence not set" : committee.cadence}</Badge>
          {kindLabel ? <Badge tone="neutral">{kindLabel}</Badge> : <Badge tone="gray">Kind not set</Badge>}
          {parentLabel && <Badge tone="neutral">Reports to {parentLabel}</Badge>}
          {committee.nextMeetingAt && <span className="muted">Next: {formatDateTime(committee.nextMeetingAt)}</span>}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {committee.cadenceRule
            ? <>Structured cadence: {describeCadenceRule(committee.cadenceRule)}. {["monthly", "quarterly", "per_year_count", "calendar_year", "annual"].includes(String(committee.cadenceRule.frequency)) ? <>Missing meetings show on <Link to="/app/coverage?tab=continuity">Coverage &amp; gaps</Link>.</> : <Link to="/app/coverage?tab=expectations">Track record gaps</Link>}</>
            : <>No structured cadence, so missing meetings are not tracked. <Link to="/app/coverage?tab=expectations">Track record gaps</Link></>}
        </div>
        {committee.cadenceNotes && <div className="muted">{committee.cadenceNotes}</div>}
        <div style={{ fontSize: 13 }} data-testid="committee-quorum-rule">
          <strong>Quorum:</strong>{" "}
          {committee.quorumRule?.quorumType
            ? <>{describeQuorumRule(committee.quorumRule, "committee")}{committee.quorumRule.notes ? <span className="muted"> · {committee.quorumRule.notes}</span> : null}</>
            : <span className="muted">No committee rule recorded; meetings fall back to the committee rule in the bylaw rules, if any.</span>}
        </div>
        <div>
          <strong style={{ fontSize: 13 }}>Mandate / terms of reference</strong>
          {!versions.length && <div className="muted" style={{ fontSize: 13 }}>No mandate versions recorded.</div>}
          <ul className="coverage-evidence">
            {versions.map((version) => (
              <li key={version.id}>
                <strong>{version.title ?? "Mandate"}</strong> · {version.effectiveFrom}{version.effectiveTo ? ` to ${version.effectiveTo}` : " onward"}
                {version === current && <> <Badge tone="success">Current</Badge></>}
                {version.quorumText && <span className="muted"> · Quorum: {version.quorumText}</span>}
                {version.documentId && <> · <Link to={`/app/documents/${version.documentId}`}>Document</Link></>}
                {version.mandate && <div className="muted" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{version.mandate}</div>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={`Structure: ${committee.name}`}
        size="wide"
        footer={<><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn btn--accent" onClick={save} disabled={!canWrite}>Save</button></>}
      >
        {form && (
          <div className="col" style={{ gap: 14 }}>
            {error && <div className="banner banner--danger" role="alert">{error}</div>}
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <Field label="Kind">
                <Select value={form.kind} onChange={(value) => setForm({ ...form, kind: value })} options={COMMITTEE_KIND_OPTIONS} placeholder="Not set" clearable />
              </Field>
              <Field label="Reports to">
                <Select value={form.parentBody} onChange={(value) => setForm({ ...form, parentBody: value })} options={PARENT_OPTIONS} placeholder="Not set" clearable />
              </Field>
              {form.parentBody === "committee" && (
                <Field label="Parent committee">
                  <Select value={form.parentCommitteeId} onChange={(value) => setForm({ ...form, parentCommitteeId: value })} options={(committees ?? []).filter((row) => row._id !== committee._id).map((row) => ({ value: row._id, label: row.name }))} placeholder="Choose" />
                </Field>
              )}
            </div>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={form.hasRule} onChange={(event) => setForm({ ...form, hasRule: event.target.checked })} />
              Use a structured cadence (needed for record-gap tracking)
            </label>
            {form.hasRule ? (
              <CadenceRuleFields value={form.rule} onChange={(rule) => setForm({ ...form, rule })} frequencies={["monthly", "quarterly", "per_year_count", "calendar_year", "ad_hoc"]} idPrefix="committee-cadence" />
            ) : (
              <Field label="Cadence label">
                <input className="input" value={form.cadenceLabel} onChange={(event) => setForm({ ...form, cadenceLabel: event.target.value })} placeholder="e.g. Ad-hoc" />
              </Field>
            )}
            <fieldset className="coverage-period" style={{ margin: 0 }}>
              <legend style={{ fontSize: 13, fontWeight: 600 }}>Quorum</legend>
              <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                The quorum this committee's meetings are checked against, as its terms of reference state it. Leave it unset to use the committee rule in the bylaw rules.
              </p>
              <QuorumRuleFields value={form.quorum} onChange={(quorum) => setForm({ ...form, quorum })} idPrefix="committee-quorum" defaultBasis="committee_members" disabled={!canWrite} />
            </fieldset>
            <div className="col" style={{ gap: 8 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>Mandate / terms-of-reference versions</strong>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setForm({ ...form, mandateVersions: [...form.mandateVersions, { id: `mandate-${Date.now().toString(36)}`, effectiveFrom: today }] })}
                >
                  <Plus size={12} /> Add version
                </button>
              </div>
              {form.mandateVersions.map((version, index) => (
                <fieldset key={version.id} className="coverage-period" style={{ margin: 0 }}>
                  <legend className="muted" style={{ fontSize: 12 }}>Version {index + 1}</legend>
                  <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                    <Field label="Title"><input className="input" value={version.title ?? ""} onChange={(event) => patchVersion(index, { title: event.target.value })} placeholder="Terms of reference (2022)" /></Field>
                    <Field label="Effective from" required><input className="input" type="date" value={version.effectiveFrom} onChange={(event) => patchVersion(index, { effectiveFrom: event.target.value })} /></Field>
                    <Field label="Effective to"><input className="input" type="date" value={version.effectiveTo ?? ""} onChange={(event) => patchVersion(index, { effectiveTo: event.target.value || undefined })} /></Field>
                    <Field label="Quorum as written"><input className="input" value={version.quorumText ?? ""} onChange={(event) => patchVersion(index, { quorumText: event.target.value })} placeholder="All five members" /></Field>
                  </div>
                  <Field label="Mandate">
                    <textarea className="input" rows={3} value={version.mandate ?? ""} onChange={(event) => patchVersion(index, { mandate: event.target.value })} />
                  </Field>
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={async () => {
                      const ok = await confirm({ title: "Remove mandate version?", message: `"${version.title ?? `Version ${index + 1}`}" (from ${version.effectiveFrom}) will be removed when you save.`, confirmLabel: "Remove", tone: "danger" });
                      if (ok) setForm({ ...form, mandateVersions: form.mandateVersions.filter((_, i) => i !== index) });
                    }}
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                </fieldset>
              ))}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
