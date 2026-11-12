import { useState } from "react";
import { useQuery } from "convex/react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarClock, Plus } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useUndoableAction } from "../../hooks/useUndoableAction";
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
  committee_structure: "Committee cadence",
};

type RulePackRule = { ruleKey: string; title: string; severity: string; bodyKind: string; rule: CadenceRule; citation?: string; caveat?: string; stored?: boolean };
type CommitteeCadence = { key: string; title: string; committeeId: string; rule: CadenceRule; effectiveFrom?: string; effectiveTo?: string };
type StoredExpectation = {
  _id: string;
  title: string;
  kind: string;
  bodyKind: string;
  committeeId?: string;
  rule: CadenceRule;
  effectiveFrom?: string;
  effectiveTo?: string;
  severity: string;
  citation?: string;
  notes?: string;
  origin: string;
  status: string;
  ruleKey?: string;
};

/** One expectation as the table lists it, whichever of the three places it comes from. */
type ExpectationRecord = {
  _id: string;
  title: string;
  severity: string;
  expectationKind: string | null;
  body: string;
  committeeId: string | null;
  cadence: string;
  effective: string;
  source: string;
  sourceNote: string;
  origin: string;
  /** "automatic" for rule-pack rules and committee cadences nobody stored. */
  status: string;
  entry:
    | { kind: "rule"; row: RulePackRule }
    | { kind: "committee"; row: CommitteeCadence }
    | { kind: "stored"; row: StoredExpectation };
};

const EXPECTATIONS_TABLE = staticRecordTable({
  id: "coverage:expectations",
  nameSingular: "continuityExpectation",
  namePlural: "continuityExpectations",
  labelSingular: "Expectation",
  labelPlural: "Expectations",
  labelIdentifierFieldName: "title",
  viewName: "All expectations",
  fields: [
    { name: "title", label: "Expectation", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } },
    {
      name: "severity",
      label: "Severity",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      config: { options: [{ value: "statutory", label: SEVERITY_LABELS.statutory, color: "red" }, { value: "bylaw", label: SEVERITY_LABELS.bylaw, color: "amber" }, { value: "practice", label: SEVERITY_LABELS.practice, color: "gray" }] },
    },
    {
      name: "expectationKind",
      label: "Record expected",
      fieldType: FIELD_TYPES.SELECT,
      size: 180,
      isVisible: false,
      config: { options: EXPECTATION_KINDS.map((kind) => ({ value: kind, label: EXPECTATION_KIND_LABELS[kind], color: "gray" })) },
    },
    { name: "body", label: "Body", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "cadence", label: "Cadence", fieldType: FIELD_TYPES.TEXT, size: 220 },
    { name: "effective", label: "Effective", fieldType: FIELD_TYPES.TEXT, size: 170 },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 170,
      config: { options: [{ value: "automatic", label: "Applies automatically", color: "blue" }, { value: "active", label: "Active", color: "green" }, { value: "archived", label: "Switched off", color: "gray" }] },
    },
    { name: "source", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 200 },
    {
      name: "origin",
      label: "Origin",
      fieldType: FIELD_TYPES.SELECT,
      size: 170,
      config: { options: Object.entries(ORIGIN_LABELS).map(([value, label]) => ({ value, label, color: "gray" })) },
    },
  ],
});

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
  const undoable = useUndoableAction();
  const navigate = useNavigate();
  const [form, setForm] = useState<ExpectationForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data) return <div className="muted">Loading expectations…</div>;
  const committeeName = (id?: string) => committees?.find((committee) => committee._id === id)?.name ?? "Committee";
  const bodyLabel = (bodyKind: string) => BODY_OPTIONS.find((option) => option.value === bodyKind)?.label ?? bodyKind;
  const effectiveRange = (from?: string, to?: string) => `${from ?? "—"}${to ? ` to ${to}` : ""}`;
  const rulePack: { title: string; rules: RulePackRule[] } | null = data.rulePack ?? null;
  const committeeCadences: CommitteeCadence[] = data.committeeCadences ?? [];
  const stored: StoredExpectation[] = data.stored;
  const records: ExpectationRecord[] = [
    ...(rulePack?.rules ?? []).filter((rule) => !rule.stored).map((rule): ExpectationRecord => ({
      _id: `rule:${rule.ruleKey}`,
      title: rule.title,
      severity: rule.severity,
      expectationKind: null,
      body: bodyLabel(rule.bodyKind),
      committeeId: null,
      cadence: describeCadenceRule(rule.rule),
      effective: "From incorporation",
      source: rule.citation ?? ORIGIN_LABELS.rule_pack,
      sourceNote: rule.caveat ?? `${rulePack?.title ?? ORIGIN_LABELS.rule_pack} · draft`,
      origin: "rule_pack",
      status: "automatic",
      entry: { kind: "rule", row: rule },
    })),
    ...committeeCadences.map((row): ExpectationRecord => ({
      _id: `committee:${row.key}`,
      title: row.title,
      severity: "practice",
      expectationKind: "meeting",
      body: committeeName(row.committeeId),
      committeeId: row.committeeId,
      cadence: describeCadenceRule(row.rule),
      effective: effectiveRange(row.effectiveFrom, row.effectiveTo),
      source: ORIGIN_LABELS.committee_structure,
      sourceNote: "Change it on the committee page",
      origin: "committee_structure",
      status: "automatic",
      entry: { kind: "committee", row },
    })),
    ...stored.map((row): ExpectationRecord => ({
      _id: row._id,
      title: row.title,
      severity: row.severity,
      expectationKind: row.kind,
      body: row.bodyKind === "committee" ? committeeName(row.committeeId) : bodyLabel(row.bodyKind),
      committeeId: row.bodyKind === "committee" ? row.committeeId ?? null : null,
      cadence: describeCadenceRule(row.rule),
      effective: effectiveRange(row.effectiveFrom, row.effectiveTo),
      source: row.citation ?? ORIGIN_LABELS[row.origin] ?? row.origin,
      sourceNote: ORIGIN_LABELS[row.origin] ?? row.origin,
      origin: row.origin,
      status: row.status,
      entry: { kind: "stored", row },
    })),
  ];
  const editStored = (row: StoredExpectation) => {
    setError(null);
    setForm({ id: row._id, title: row.title, kind: row.kind, bodyKind: row.bodyKind, committeeId: row.committeeId, rule: row.rule, effectiveFrom: row.effectiveFrom ?? "", effectiveTo: row.effectiveTo ?? "", severity: row.severity, citation: row.citation ?? "", notes: row.notes ?? "" });
  };
  /** A committee's cadence opens its committee; a stored expectation opens for editing. */
  const openExpectation = (record: ExpectationRecord) => {
    if (record.entry.kind === "committee") navigate(`/app/committees/${record.entry.row.committeeId}`);
    else if (record.entry.kind === "stored" && canWrite) editStored(record.entry.row);
  };

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
      toast.success(label, describeRunResult(result));
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
        <RecordListTable<ExpectationRecord>
          variant="card"
          table={EXPECTATIONS_TABLE}
          tableId="coverage-expectations"
          label="Expectations"
          icon={<CalendarClock size={14} />}
          records={records}
          onOpen={openExpectation}
          toolbarActions={canWrite ? (
            <>
              {rulePack?.rules.some((rule) => !rule.stored) && (
                <button type="button" className="btn btn--sm" onClick={() => run("Rule pack stored", () => seed({ societyId }))}>Store rule pack to edit</button>
              )}
              <button type="button" className="btn btn--sm" disabled={!data.hasActiveBylawRules} title={data.hasActiveBylawRules ? undefined : "Activate a bylaw rule set first"} onClick={() => run("Derived from bylaw rules", () => derive({ societyId }))}>Derive from bylaw rules</button>
              <button type="button" className="btn-action btn-action--primary" onClick={() => { setError(null); setForm(emptyForm()); }}><Plus size={12} /> Add expectation</button>
            </>
          ) : undefined}
          renderCell={({ record, field }) => {
            if (field.name === "severity") return <Badge tone={SEVERITY_TONE[record.severity] ?? "neutral"}>{SEVERITY_LABELS[record.severity] ?? record.severity}</Badge>;
            if (field.name === "expectationKind") return record.expectationKind ? <Badge tone="neutral">{EXPECTATION_KIND_LABELS[record.expectationKind as keyof typeof EXPECTATION_KIND_LABELS] ?? record.expectationKind}</Badge> : <span className="muted">—</span>;
            if (field.name === "status") {
              if (record.status === "automatic") return <Badge tone="info">Applies automatically</Badge>;
              if (record.status === "active") return <span className="muted">Active</span>;
              return <Badge tone="gray">{record.status === "archived" ? "Switched off" : record.status}</Badge>;
            }
            if (field.name === "body" && record.committeeId) return <Link to={`/app/committees/${record.committeeId}`}>{record.body}</Link>;
            if (field.name === "effective") return <span className="muted">{record.effective}</span>;
            if (field.name === "source") return <span title={record.sourceNote}>{record.source}</span>;
            return undefined;
          }}
          renderRowActions={(record) => {
            const { entry } = record;
            if (entry.kind === "committee")
              return <Link className="btn btn--sm" to={`/app/committees/${entry.row.committeeId}`}>Open committee</Link>;
            if (entry.kind !== "stored" || !canWrite) return null;
            const row = entry.row;
            return (
              <>
                <button type="button" className="btn btn--sm" onClick={() => editStored(row)}>Edit</button>
                <button type="button" className="btn btn--sm" onClick={() => row.status === "archived"
                  ? run("Expectation restored", () => update({ id: row._id, patch: { status: "active" } }))
                  : void undoable({
                    message: "Expectation switched off",
                    description: row.title,
                    errorMessage: "Expectation switched off failed",
                    dedupeKey: `expectation-off-${row._id}`,
                    run: () => update({ id: row._id, patch: { status: "archived" } }),
                    undo: () => update({ id: row._id, patch: { status: row.status } }),
                    undoneMessage: "Expectation restored",
                  })}>
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
              </>
            );
          }}
          renderPhoneCard={(record, { open, field, selecting }) => (
            <RecordTablePhoneCard
              title={record.title}
              badge={field("severity")}
              meta={[record.cadence, record.body]}
              detail={[record.status === "automatic" ? "Applies automatically" : record.status === "archived" ? "Switched off" : "", record.source]}
              onOpen={record.entry.kind === "committee" || (record.entry.kind === "stored" && canWrite) ? open : undefined}
              selecting={selecting}
            />
          )}
          emptyState={<RecordTableEmpty title="No expectations yet." description="No record-continuity rule pack exists for this jurisdiction; add body cadences manually." />}
        />
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

/** "5 expectations stored, 1 updated" instead of raw result keys. */
function describeRunResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const counts = result as Record<string, unknown>;
  const parts: string[] = [];
  const plural = (n: number) => `${n} expectation${n === 1 ? "" : "s"}`;
  if (typeof counts.created === "number") parts.push(counts.created ? `${plural(counts.created)} added` : "Nothing new to add");
  if (typeof counts.updated === "number" && counts.updated) parts.push(`${plural(counts.updated)} updated`);
  return parts.length ? parts.join(", ") : undefined;
}
