import { useState } from "react";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { usePermissions } from "../../hooks/usePermissions";
import type { CadenceSuggestion } from "../../../shared/continuity";
import { describeCadenceRule, EXPECTATION_KIND_LABELS, EXPECTATION_KINDS, type CadenceRule } from "../../../shared/continuityRules";
import { CadenceRuleFields, cleanCadenceRule } from "./CadenceRuleFields";
import { SEVERITY_LABELS, SEVERITY_TONE } from "./statusMeta";

type ExpectationForm = {
  id?: string;
  title: string;
  kind: string;
  bodyKind: string;
  committeeId?: string;
  rule: CadenceRule;
  effectiveFrom: string;
  effectiveTo: string;
  severity: string;
  citation: string;
  notes: string;
  origin?: string;
  confidence?: number;
};

const BODY_OPTIONS = [
  { value: "board", label: "Board of directors" },
  { value: "members", label: "Members (general meetings)" },
  { value: "committee", label: "A committee" },
  { value: "organization", label: "Organization" },
];

const ORIGIN_LABELS: Record<string, string> = {
  rule_pack: "Rule pack",
  bylaw_rules: "Bylaw rules",
  manual: "Manual",
  inferred: "Confirmed from history",
  schedule_document: "Meeting schedule",
};

const emptyForm = (): ExpectationForm => ({ title: "", kind: "meeting", bodyKind: "board", rule: { frequency: "monthly" }, effectiveFrom: "", effectiveTo: "", severity: "practice", citation: "", notes: "" });

/** Governance expectations: rule pack, bylaw-derived, manual and inferred cadences. */
export function ExpectationsPanel({ societyId, suggestions }: { societyId: string; suggestions: CadenceSuggestion[] }) {
  const { can } = usePermissions();
  const canWrite = can("deadlines:write");
  const data = useQuery(api.continuity.listExpectations, { societyId }) as any;
  const committees = useQuery(api.committees.list, can("committees:read") ? { societyId } : "skip") as any[] | undefined;
  const create = usePermissionedMutation(api.continuity.createExpectation, canWrite);
  const update = usePermissionedMutation(api.continuity.updateExpectation, canWrite);
  const remove = usePermissionedMutation(api.continuity.removeExpectation, canWrite);
  const seed = usePermissionedMutation(api.continuity.seedRulePack, canWrite);
  const derive = usePermissionedMutation(api.continuity.deriveFromBylawRules, canWrite);
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<ExpectationForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data) return <div className="muted">Loading expectations…</div>;
  const committeeName = (id?: string) => committees?.find((committee) => committee._id === id)?.name ?? "Committee";

  const save = async () => {
    if (!form) return;
    setError(null);
    const payload = {
      title: form.title.trim(),
      kind: form.kind,
      bodyKind: form.bodyKind,
      ...(form.bodyKind === "committee" && form.committeeId ? { committeeId: form.committeeId } : {}),
      rule: cleanCadenceRule(form.rule),
      ...(form.effectiveFrom ? { effectiveFrom: form.effectiveFrom } : {}),
      ...(form.effectiveTo ? { effectiveTo: form.effectiveTo } : {}),
      severity: form.severity,
      ...(form.citation.trim() ? { citation: form.citation.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    };
    try {
      if (form.id) await update({ id: form.id, patch: payload });
      else await create({ societyId, ...payload, origin: form.origin ?? "manual", ...(form.confidence !== undefined ? { confidence: form.confidence } : {}) });
      toast.success(form.id ? "Expectation updated" : "Expectation added");
      setForm(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the expectation.");
    }
  };

  const run = async (label: string, action: () => Promise<any>) => {
    try {
      const result = await action();
      toast.success(label, result && typeof result === "object" ? Object.entries(result).map(([key, value]) => `${key}: ${value}`).join(", ") : undefined);
    } catch (caught) {
      toast.error(`${label} failed`, caught instanceof Error ? caught.message : "Please try again.");
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Expectations</h2>
          <span className="card__subtitle">What records should exist: meetings by body, AGMs, filings, statements, director terms</span>
        </div>
        {canWrite && (
          <div className="card__body" style={{ paddingBottom: 0 }}>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {data.rulePack && data.rulePack.rules.some((rule: any) => !rule.stored) && (
                <button type="button" className="btn btn--sm" onClick={() => run("Rule pack stored", () => seed({ societyId }))}>Store rule pack to edit</button>
              )}
              <button type="button" className="btn btn--sm" disabled={!data.hasActiveBylawRules} title={data.hasActiveBylawRules ? undefined : "Activate a bylaw rule set first"} onClick={() => run("Derived from bylaw rules", () => derive({ societyId }))}>Derive from bylaw rules</button>
              <button type="button" className="btn-action btn-action--primary" onClick={() => { setError(null); setForm(emptyForm()); }}><Plus size={12} /> Add expectation</button>
            </div>
          </div>
        )}
        <div className="coverage-table-scroll">
          <table className="table">
            <thead>
              <tr><th>Expectation</th><th>Body</th><th>Cadence</th><th>Effective</th><th>Source</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {data.rulePack?.rules.filter((rule: any) => !rule.stored).map((rule: any) => (
                <tr key={rule.ruleKey}>
                  <td>
                    <strong>{rule.title}</strong>
                    <div className="row" style={{ gap: 4, marginTop: 2 }}><Badge tone={SEVERITY_TONE[rule.severity]}>{SEVERITY_LABELS[rule.severity]}</Badge><Badge tone="info">Applies automatically</Badge></div>
                  </td>
                  <td>{BODY_OPTIONS.find((option) => option.value === rule.bodyKind)?.label}</td>
                  <td>{describeCadenceRule(rule.rule)}</td>
                  <td className="muted">From incorporation</td>
                  <td><span title={rule.caveat}>{rule.citation}</span><div className="muted" style={{ fontSize: 11 }}>{data.rulePack.title} · draft</div></td>
                  <td />
                </tr>
              ))}
              {data.stored.map((row: any) => (
                <tr key={row._id} style={row.status === "archived" ? { opacity: 0.6 } : undefined}>
                  <td>
                    <strong>{row.title}</strong>
                    <div className="row" style={{ gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                      <Badge tone={SEVERITY_TONE[row.severity] ?? "neutral"}>{SEVERITY_LABELS[row.severity] ?? row.severity}</Badge>
                      <Badge tone="neutral">{EXPECTATION_KIND_LABELS[row.kind as keyof typeof EXPECTATION_KIND_LABELS] ?? row.kind}</Badge>
                      {row.status !== "active" && <Badge tone="gray">{row.status}</Badge>}
                    </div>
                  </td>
                  <td>{row.bodyKind === "committee" ? committeeName(row.committeeId) : BODY_OPTIONS.find((option) => option.value === row.bodyKind)?.label}</td>
                  <td>{describeCadenceRule(row.rule)}</td>
                  <td className="muted">{row.effectiveFrom ?? "—"}{row.effectiveTo ? ` to ${row.effectiveTo}` : ""}</td>
                  <td>{row.citation ?? ORIGIN_LABELS[row.origin] ?? row.origin}<div className="muted" style={{ fontSize: 11 }}>{ORIGIN_LABELS[row.origin] ?? row.origin}</div></td>
                  <td>
                    {canWrite && (
                      <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                        <button type="button" className="btn btn--sm" onClick={() => { setError(null); setForm({ id: row._id, title: row.title, kind: row.kind, bodyKind: row.bodyKind, committeeId: row.committeeId, rule: row.rule, effectiveFrom: row.effectiveFrom ?? "", effectiveTo: row.effectiveTo ?? "", severity: row.severity, citation: row.citation ?? "", notes: row.notes ?? "" }); }}>Edit</button>
                        <button type="button" className="btn btn--sm" onClick={() => run(row.status === "archived" ? "Expectation restored" : "Expectation switched off", () => update({ id: row._id, patch: { status: row.status === "archived" ? "active" : "archived" } }))}>
                          {row.status === "archived" ? "Restore" : "Switch off"}
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--danger"
                          onClick={async () => {
                            const ok = await confirm({
                              title: "Delete expectation?",
                              message: `"${row.title}" and every period mark recorded against it (never held, cancelled, waived, attached evidence) will be deleted.${row.ruleKey ? " A rule-pack rule then applies automatically again." : ""}`,
                              confirmLabel: "Delete",
                              tone: "danger",
                            });
                            if (ok) await run("Expectation deleted", () => remove({ id: row._id }));
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!data.stored.length && !data.rulePack && (
                <tr><td colSpan={6} className="table__empty">No expectations yet. No record-continuity rule pack exists for this jurisdiction; add body cadences manually.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Suggested from history</h2>
          <span className="card__subtitle">Cadence inferred from meeting dates (median interval). Confirm to start tracking gaps.</span>
        </div>
        <div className="card__body">
          {!suggestions.length && <div className="muted">No suggestions: every body with four or more meetings already has an expectation.</div>}
          {suggestions.map((suggestion) => (
            <div key={suggestion.key} className="coverage-gap-row">
              <div>
                <strong>{suggestion.bodyLabel}: {describeCadenceRule(suggestion.rule)}</strong>
                <div className="muted" style={{ fontSize: 13 }}>{suggestion.rationale} Confidence {Math.round(suggestion.confidence * 100)}%.</div>
              </div>
              {canWrite && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => { setError(null); setForm({ ...emptyForm(), title: suggestion.title, bodyKind: suggestion.bodyKind, committeeId: suggestion.committeeId, rule: suggestion.rule, effectiveFrom: suggestion.effectiveFrom, origin: "inferred", confidence: suggestion.confidence }); }}
                >
                  Review and confirm
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? "Edit expectation" : "Add expectation"}
        footer={<><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn btn--accent" onClick={save} disabled={!canWrite}>Save</button></>}
      >
        {form && (
          <div className="col" style={{ gap: 12 }}>
            {error && <div className="banner banner--danger" role="alert">{error}</div>}
            <Field label="Title" required>
              <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Operations Committee meets monthly except summer" />
            </Field>
            <Field label="Record expected">
              <Select value={form.kind} onChange={(value) => setForm({ ...form, kind: value })} options={EXPECTATION_KINDS.map((kind) => ({ value: kind, label: EXPECTATION_KIND_LABELS[kind] }))} />
            </Field>
            <Field label="Body">
              <Select value={form.bodyKind} onChange={(value) => setForm({ ...form, bodyKind: value })} options={BODY_OPTIONS} />
            </Field>
            {form.bodyKind === "committee" && (
              <Field label="Committee" required>
                <Select value={form.committeeId ?? ""} onChange={(value) => setForm({ ...form, committeeId: value || undefined })} options={(committees ?? []).map((committee) => ({ value: committee._id, label: committee.name }))} placeholder="Choose a committee" />
              </Field>
            )}
            <CadenceRuleFields value={form.rule} onChange={(rule) => setForm({ ...form, rule })} idPrefix="expectation" />
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <Field label="Effective from">
                <input className="input" type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} />
              </Field>
              <Field label="Effective to">
                <input className="input" type="date" value={form.effectiveTo} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })} />
              </Field>
            </div>
            <Field label="Severity">
              <Select value={form.severity} onChange={(value) => setForm({ ...form, severity: value })} options={Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Authority (citation, bylaw or TOR section)">
              <input className="input" value={form.citation} onChange={(event) => setForm({ ...form, citation: event.target.value })} placeholder="e.g. Ops Committee Terms of Reference (2022), s. 4" />
            </Field>
            <Field label="Notes">
              <textarea className="input" rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
