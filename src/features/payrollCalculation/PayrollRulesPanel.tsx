import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Link } from "react-router-dom";
import { Field } from "../../components/ui";
import { Money } from "../../components/Money";
import { usePermissions } from "../../hooks/usePermissions";
import {
  calculatePayrollDeductions,
  emptyPayrollYtd,
} from "../../../shared/payrollDeductions";
import {
  cleanPayrollRuleDraft,
  cloneOfficialPayrollRule,
  comparePayrollRules,
  OFFICIAL_PAYROLL_RULE_EDITIONS,
  PAYROLL_RULE_SOURCE_CATALOG,
  payrollPercentDecimal,
  payrollPercentDisplay,
  payrollRuleCompatibility,
  type PayrollRuleDraft,
  type PayrollRuleEdition,
} from "../../../shared/payrollRules";
import { amountInput, payrollFailure, payrollMoney } from "./payrollUi";
import { usePayrollRuleEditions } from "./PayrollRuleEditionPicker";
export { PayrollRuleEditionPicker } from "./PayrollRuleEditionPicker";

const freshKey = () => crypto.randomUUID();
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function draftOf(edition: PayrollRuleEdition): PayrollRuleDraft {
  return {
    name: edition.name,
    ...(edition.description ? { description: edition.description } : {}),
    rateSet: structuredClone(edition.rateSet),
    sourceEvidence: structuredClone(edition.sourceEvidence),
  };
}
type Editing = {
  key: string;
  draft: PayrollRuleDraft;
  edition?: PayrollRuleEdition;
  sourceId?: string;
  baseOfficialId: string;
};

export function PayrollRulesPanel({ societyId }: { societyId: string }) {
  const permissions = usePermissions(),
    canWrite = permissions.can("financials:write"),
    canReview = canWrite && ["Owner", "Admin"].includes(permissions.role ?? "");
  const editions = usePayrollRuleEditions({ societyId }),
    [editing, setEditing] = useState<Editing>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const save = useMutation(api.payrollRules.saveDraft),
    review = useMutation(api.payrollRules.review),
    publish = useMutation(api.payrollRules.publish),
    retire = useMutation(api.payrollRules.retire);
  async function operate(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setStatus(message);
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Payroll rules library"
      className="payroll-calculator__stack"
    >
      <h2>Payroll rules library</h2>
      <p>
        Create a working copy of a reviewed official rate edition, edit its
        parameters, compare the result and retain official evidence. An
        administrator reviews and publishes the exact version before it can be
        selected for native payroll. Published contents stay frozen; changes
        create a new revision.
      </p>
      <p>
        Percent fields show percentages: enter <strong>5.95</strong> for 5.95%.
        JSON stores that rate as <strong>0.0595</strong> and money as integer
        cents. New parameters keep the existing formula policy; imported code
        and unsupported jurisdictions are rejected.
      </p>
      <details>
        <summary>
          Official sources and where to enter other payroll rules
        </summary>
        <ul>
          {PAYROLL_RULE_SOURCE_CATALOG.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.authority}: {source.title}
              </a>
              <p>{source.guidance}</p>
            </li>
          ))}
        </ul>
        <p>
          <Link to="/app/payroll/calculator?tab=employer">Employer setup</Link>{" "}
          holds actual EHT class/location/openings, EI coverage, WorkSafe net
          rates and employer costs.{" "}
          <Link to="/app/payroll/calculator?tab=codes">Earning codes</Link>{" "}
          holds reviewed earning classifications.{" "}
          <Link to="/app/payroll/calculator?tab=profiles">
            Employee profiles
          </Link>{" "}
          holds effective wages, TD1 declarations, leave and employment policy.
          This library changes deduction parameters; ordinary employment policy
          and formula logic remain reviewed code.
        </p>
      </details>
      <details open>
        <summary>Reviewed official editions</summary>
        <div className="payroll-calculator__form-grid">
          {OFFICIAL_PAYROLL_RULE_EDITIONS.map((edition) => (
            <article
              className="card payroll-calculator__panel"
              key={edition.id}
            >
              <h3>{edition.id}</h3>
              <p>
                {edition.effectiveFrom}–{edition.effectiveTo} ·{" "}
                {edition.province} · {edition.method}
              </p>
              <p>
                Employee CPP {payrollPercentDisplay(edition.cpp.rate)}% · CPP2{" "}
                {payrollPercentDisplay(edition.cpp.secondRate)}% · EI{" "}
                {payrollPercentDisplay(edition.ei.rate)}%.
              </p>
              <button
                className="btn"
                type="button"
                disabled={!canWrite || busy}
                onClick={() => {
                  setEditing({
                    key: freshKey(),
                    draft: cloneOfficialPayrollRule(edition.id),
                    baseOfficialId: edition.id,
                  });
                  setError("");
                }}
              >
                Clone {edition.id}
              </button>
            </article>
          ))}
        </div>
      </details>
      {editions.loader}
      {!editions.ready && (
        <p role="status">Loading every workspace rule-edition page…</p>
      )}
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {editing && (
        <PayrollRuleEditor
          key={editing.key}
          initial={editing}
          busy={busy}
          onCancel={() => setEditing(undefined)}
          onLoad={(draft) => setEditing({ ...editing, key: freshKey(), draft })}
          onSave={(fields) =>
            operate(async () => {
              await save({
                societyId,
                ...(editing.edition
                  ? {
                      id: editing.edition._id,
                      expectedHash: editing.edition.contentHash,
                    }
                  : {}),
                ...(editing.sourceId ? { sourceId: editing.sourceId } : {}),
                baseOfficialId: editing.baseOfficialId,
                fields,
              });
              setEditing(undefined);
            }, "Working draft saved. Review the saved content before publication.")
          }
        />
      )}
      <h3>Workspace editions</h3>
      {editions.ready && !editions.rows.length && (
        <p>
          No workspace editions yet. Clone one of the official editions to
          begin.
        </p>
      )}
      {editions.rows.map((edition) => (
        <RuleCard
          key={`${edition._id}:${edition.updatedAtISO}`}
          edition={edition}
          canWrite={canWrite}
          canReview={canReview}
          busy={busy}
          onEdit={() =>
            setEditing({
              key: freshKey(),
              draft: draftOf(edition),
              edition,
              baseOfficialId: edition.baseOfficialId,
            })
          }
          onRevision={() =>
            setEditing({
              key: freshKey(),
              draft: { ...draftOf(edition), name: `${edition.name} revision` },
              sourceId: edition._id,
              baseOfficialId: edition.baseOfficialId,
            })
          }
          onReview={(evidence, confirmed) =>
            operate(
              () =>
                review({
                  societyId,
                  id: edition._id,
                  expectedHash: edition.contentHash,
                  evidence,
                  confirmed,
                }),
              "Exact rule content reviewed. Publication is a separate administrator action.",
            )
          }
          onPublish={() =>
            operate(
              () =>
                publish({
                  societyId,
                  id: edition._id,
                  expectedHash: edition.contentHash,
                }),
              "Edition published. It can now be explicitly selected for compatible native payroll.",
            )
          }
          onRetire={(reason) =>
            operate(
              () => retire({ societyId, id: edition._id, reason }),
              "Edition retired. Existing frozen payroll retains its original rules.",
            )
          }
        />
      ))}
    </section>
  );
}

function RuleCard({
  edition,
  canWrite,
  canReview,
  busy,
  onEdit,
  onRevision,
  onReview,
  onPublish,
  onRetire,
}: {
  edition: PayrollRuleEdition;
  canWrite: boolean;
  canReview: boolean;
  busy: boolean;
  onEdit: () => void;
  onRevision: () => void;
  onReview: (evidence: string, confirmed: boolean) => void;
  onPublish: () => void;
  onRetire: (reason: string) => void;
}) {
  const [evidence, setEvidence] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [reason, setReason] = useState("");
  const compatibility = payrollRuleCompatibility(edition.rateSet),
    baseline = OFFICIAL_PAYROLL_RULE_EDITIONS.find(
      (value) => value.id === edition.baseOfficialId,
    );
  const differences = baseline
    ? comparePayrollRules(baseline, edition.rateSet)
    : [];
  return (
    <article
      className="card payroll-calculator__panel"
      aria-label={`Rule edition ${edition.name}`}
    >
      <h4>
        {edition.name} · revision {edition.revision} · {edition.status}
      </h4>
      <p>
        {edition.rateSet.year} · {edition.rateSet.province} ·{" "}
        {edition.rateSet.method} · {edition.rateSet.effectiveFrom}–
        {edition.rateSet.effectiveTo}
      </p>
      <p>{compatibility.reason}</p>
      <p className="muted">SHA-256 {edition.contentHash}</p>
      <div className="payroll-calculator__actions">
        {edition.status === "draft" && (
          <button
            className="btn"
            type="button"
            disabled={!canWrite || busy}
            onClick={onEdit}
          >
            Edit working draft
          </button>
        )}
        <button
          className="btn"
          type="button"
          disabled={!canWrite || busy}
          onClick={onRevision}
        >
          Create new revision
        </button>
        <button
          className="btn"
          type="button"
          onClick={() =>
            download(
              `payroll-rules-${edition.libraryId}-r${edition.revision}.json`,
              {
                format: "societyer-payroll-rules",
                version: 1,
                draft: draftOf(edition),
                provenance: {
                  id: edition._id,
                  revision: edition.revision,
                  contentHash: edition.contentHash,
                  status: edition.status,
                  reviewedByUserId: edition.reviewedByUserId,
                  reviewedAtISO: edition.reviewedAtISO,
                  publishedAtISO: edition.publishedAtISO,
                },
              },
            )
          }
        >
          Export edition JSON
        </button>
      </div>
      <details>
        <summary>Parameters, source evidence and baseline comparison</summary>
        <ParameterSummary draft={draftOf(edition)} />
        <RuleDifferences differences={differences} />
        <p>
          Review: {edition.reviewEvidence ?? "Not yet reviewed"} · reviewer{" "}
          {edition.reviewedByUserId ?? "—"} · {edition.reviewedAtISO ?? "—"}.
        </p>
        {edition.retirementReason && (
          <p>
            Retired: {edition.retirementReason} · {edition.retiredAtISO}.
          </p>
        )}
        <details>
          <summary>Full frozen rate JSON and archived baseline hashes</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(edition.rateSet, null, 2)}
          </pre>
        </details>
      </details>
      {canReview && edition.status === "draft" && (
        <form
          aria-label={`Review ${edition.name}`}
          onSubmit={(event) => {
            event.preventDefault();
            onReview(evidence, confirmed);
          }}
        >
          <Field label="Rule review evidence">
            <textarea
              className="input"
              required
              maxLength={8000}
              value={evidence}
              onChange={(event) => {
                setEvidence(event.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I reviewed the exact rates, caps, brackets, effective dates and
            official source evidence
          </label>
          <button className="btn" disabled={busy || !confirmed}>
            Review exact edition
          </button>
        </form>
      )}
      {canReview && edition.status === "reviewed" && (
        <button
          className="btn btn--accent"
          type="button"
          disabled={busy}
          onClick={onPublish}
        >
          Publish reviewed edition
        </button>
      )}
      {canReview && ["reviewed", "published"].includes(edition.status) && (
        <details>
          <summary>Retire this edition</summary>
          <Field label="Rule retirement reason">
            <textarea
              className="input"
              maxLength={4000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <button
            className="btn"
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() => onRetire(reason)}
          >
            Retire edition
          </button>
        </details>
      )}
    </article>
  );
}

type BracketDraft = {
  key: string;
  threshold: string;
  rate: string;
  constant: string;
};
const bracketDraft = (
  rows: PayrollRuleDraft["rateSet"]["federal"]["brackets"],
) =>
  rows.map((row) => ({
    key: freshKey(),
    threshold: amountInput(row.thresholdCents),
    rate: payrollPercentDisplay(row.rate),
    constant: amountInput(row.constantCents),
  }));
const words = (key: string) =>
  key
    .replace(/Cents$/, "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
function BracketEditor({
  label,
  rows,
  onChange,
}: {
  label: string;
  rows: BracketDraft[];
  onChange: (rows: BracketDraft[]) => void;
}) {
  return (
    <fieldset>
      <legend>{label} brackets</legend>
      {rows.map((row, index) => (
        <div key={row.key} className="payroll-calculator__form-grid">
          <Field label={`${label} bracket ${index + 1} threshold (CAD)`}>
            <input
              className="input"
              inputMode="decimal"
              value={row.threshold}
              onChange={(event) =>
                onChange(
                  rows.map((value) =>
                    value.key === row.key
                      ? { ...value, threshold: event.target.value }
                      : value,
                  ),
                )
              }
            />
          </Field>
          <Field label={`${label} bracket ${index + 1} rate (%)`}>
            <input
              className="input"
              inputMode="decimal"
              value={row.rate}
              onChange={(event) =>
                onChange(
                  rows.map((value) =>
                    value.key === row.key
                      ? { ...value, rate: event.target.value }
                      : value,
                  ),
                )
              }
            />
          </Field>
          <Field label={`${label} bracket ${index + 1} constant (CAD)`}>
            <input
              className="input"
              inputMode="decimal"
              value={row.constant}
              onChange={(event) =>
                onChange(
                  rows.map((value) =>
                    value.key === row.key
                      ? { ...value, constant: event.target.value }
                      : value,
                  ),
                )
              }
            />
          </Field>
          <button
            className="btn"
            type="button"
            disabled={rows.length === 1}
            onClick={() =>
              onChange(rows.filter((value) => value.key !== row.key))
            }
          >
            Remove {label} bracket {index + 1}
          </button>
        </div>
      ))}
      <button
        className="btn"
        type="button"
        disabled={rows.length >= 20}
        onClick={() =>
          onChange([
            ...rows,
            { key: freshKey(), threshold: "", rate: "", constant: "" },
          ])
        }
      >
        Add {label} bracket
      </button>
      <p className="muted">
        Use the official threshold, rate and constant together. Constants are
        edited explicitly; they are not guessed from rounded thresholds.
      </p>
    </fieldset>
  );
}

function PayrollRuleEditor({
  initial,
  busy,
  onCancel,
  onSave,
  onLoad,
}: {
  initial: Editing;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: PayrollRuleDraft) => void;
  onLoad: (draft: PayrollRuleDraft) => void;
}) {
  const [name, setName] = useState(initial.draft.name),
    [description, setDescription] = useState(initial.draft.description ?? ""),
    [year, setYear] = useState(String(initial.draft.rateSet.year)),
    [method, setMethod] = useState(initial.draft.rateSet.method),
    [from, setFrom] = useState(initial.draft.rateSet.effectiveFrom),
    [to, setTo] = useState(initial.draft.rateSet.effectiveTo),
    [sources, setSources] = useState(
      initial.draft.sourceEvidence.map((source) => ({
        ...source,
        key: freshKey(),
      })),
    );
  const [federal, setFederal] = useState<BracketDraft[]>(() =>
      bracketDraft(initial.draft.rateSet.federal.brackets),
    ),
    [provincial, setProvincial] = useState<BracketDraft[]>(() =>
      bracketDraft(initial.draft.rateSet.provincial.brackets),
    );
  const [values, setValues] = useState<Record<string, string>>({}),
    [json, setJson] = useState(""),
    [validated, setValidated] = useState<PayrollRuleDraft>(),
    [error, setError] = useState("");
  const baseline = OFFICIAL_PAYROLL_RULE_EDITIONS.find(
    (edition) => edition.id === initial.baseOfficialId,
  )!;
  const fields = (group: "cpp" | "ei" | "federal" | "provincial") =>
    Object.entries(initial.draft.rateSet[group]).filter(
      ([key]) => key !== "brackets" && key !== "employerMultiplier",
    );
  const valueOf = (group: string, key: string, value: unknown) =>
    values[`${group}.${key}`] ??
    (key.endsWith("Cents")
      ? amountInput(Number(value))
      : payrollPercentDisplay(String(value)));
  function build() {
    const rateSet = structuredClone(initial.draft.rateSet);
    rateSet.year = Number(year);
    rateSet.method = method;
    rateSet.effectiveFrom = from;
    rateSet.effectiveTo = to;
    for (const group of ["cpp", "ei", "federal", "provincial"] as const)
      for (const [key, value] of fields(group)) {
        const raw = valueOf(group, key, value);
        (rateSet[group] as unknown as Record<string, unknown>)[key] =
          key.endsWith("Cents")
            ? payrollMoney(raw, `${group} ${words(key)}`)!
            : payrollPercentDecimal(raw);
      }
    const parse = (rows: BracketDraft[]) =>
      rows.map((row) => ({
        thresholdCents: payrollMoney(row.threshold, "Bracket threshold")!,
        rate: payrollPercentDecimal(row.rate),
        constantCents: payrollMoney(row.constant, "Bracket constant")!,
      }));
    rateSet.federal.brackets = parse(federal);
    rateSet.provincial.brackets = parse(provincial);
    return cleanPayrollRuleDraft({
      name,
      description,
      rateSet,
      sourceEvidence: sources.map(({ key: _key, ...source }) => source),
    });
  }
  function validate() {
    try {
      const draft = build();
      setValidated(draft);
      setError("");
      return draft;
    } catch (cause) {
      setValidated(undefined);
      setError(payrollFailure(cause));
      return undefined;
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const draft = validate();
    if (draft) onSave(draft);
  }
  return (
    <section
      className="card payroll-calculator__panel"
      aria-label="Payroll rule editor"
    >
      <h3>{initial.edition ? "Edit working draft" : "New working edition"}</h3>
      <form
        aria-label="Payroll rule parameters"
        onChange={() => setValidated(undefined)}
        onSubmit={submit}
      >
        <div className="payroll-calculator__form-grid">
          <Field label="Rule edition name">
            <input
              className="input"
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Rule description">
            <textarea
              className="input"
              maxLength={4000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Rule year">
            <input
              className="input"
              type="number"
              min={2026}
              max={2100}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          </Field>
          <Field label="Rule method">
            <select
              className="input"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              <option value="option1">Option 1</option>
              <option value="option2">Option 2</option>
            </select>
          </Field>
          <Field label="Rule effective from">
            <input
              className="input"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="Rule effective to">
            <input
              className="input"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
        </div>
        <p>
          Province BC · formula engine {initial.draft.rateSet.engineVersion}.
          Future-year data can be stored and reviewed; it cannot activate until
          an engine with that coverage is reviewed. January and July formula
          policies keep separate ranges.
        </p>
        {(["cpp", "ei", "federal", "provincial"] as const).map((group) => (
          <details key={group}>
            <summary>
              {
                {
                  cpp: "CPP and CPP2 rates, exemptions and caps",
                  ei: "EI employee rate and annual caps",
                  federal: "Federal claims and tax brackets",
                  provincial: "BC claims, tax reduction and brackets",
                }[group]
              }
            </summary>
            <div className="payroll-calculator__form-grid">
              {fields(group).map(([key, value]) => (
                <Field
                  key={key}
                  label={`${group === "cpp" ? "CPP" : group === "ei" ? "EI" : group === "federal" ? "Federal" : "BC"} ${words(key)} ${key.endsWith("Cents") ? "(CAD)" : "(%)"}`}
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    value={valueOf(group, key, value)}
                    onChange={(event) =>
                      setValues((previous) => ({
                        ...previous,
                        [`${group}.${key}`]: event.target.value,
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
            {group === "federal" && (
              <BracketEditor
                label="Federal"
                rows={federal}
                onChange={(rows) => {
                  setFederal(rows);
                  setValidated(undefined);
                }}
              />
            )}
            {group === "provincial" && (
              <BracketEditor
                label="BC"
                rows={provincial}
                onChange={(rows) => {
                  setProvincial(rows);
                  setValidated(undefined);
                }}
              />
            )}
            {group === "ei" && (
              <p>
                Standard employer multiplier 1.4. Record approved reduced
                employer coverage in Employer setup or the employee override,
                with its actual approval evidence.
              </p>
            )}
          </details>
        ))}
        <details open>
          <summary>Official evidence for this working edition</summary>
          {sources.map((source, index) => (
            <fieldset key={source.key}>
              <legend>Rule source {index + 1}</legend>
              <div className="payroll-calculator__form-grid">
                {(
                  ["authority", "title", "url", "reviewedOn", "notes"] as const
                ).map((key) => (
                  <Field
                    key={key}
                    label={`Rule source ${index + 1} ${key === "reviewedOn" ? "review date" : key}`}
                  >
                    <input
                      className="input"
                      type={
                        key === "reviewedOn"
                          ? "date"
                          : key === "url"
                            ? "url"
                            : "text"
                      }
                      required
                      value={source[key]}
                      onChange={(event) =>
                        setSources((previous) =>
                          previous.map((value) =>
                            value.key === source.key
                              ? { ...value, [key]: event.target.value }
                              : value,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
              </div>
              <button
                className="btn"
                type="button"
                disabled={sources.length === 1}
                onClick={() => {
                  setSources((previous) =>
                    previous.filter((value) => value.key !== source.key),
                  );
                  setValidated(undefined);
                }}
              >
                Remove rule source {index + 1}
              </button>
            </fieldset>
          ))}
          <button
            className="btn"
            type="button"
            disabled={sources.length >= 30}
            onClick={() => {
              setSources((previous) => [
                ...previous,
                {
                  key: freshKey(),
                  authority: "",
                  title: "",
                  url: "",
                  reviewedOn: new Date().toISOString().slice(0, 10),
                  notes: "",
                },
              ]);
              setValidated(undefined);
            }}
          >
            Add official source evidence
          </button>
          <p className="muted">
            Archived baseline SHA-256 values identify the original downloaded
            files. They do not certify manually changed numbers. Retain the
            source and actual review evidence for every change.
          </p>
        </details>
        {error && <p role="alert">{error}</p>}
        <div className="payroll-calculator__actions">
          <button type="button" className="btn" onClick={validate}>
            Validate and compare rules
          </button>
          <button type="submit" className="btn btn--accent" disabled={busy}>
            Save working draft
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel rule editing
          </button>
        </div>
        {validated && (
          <div aria-live="polite">
            <p>
              Parameter validation passed.{" "}
              {payrollRuleCompatibility(validated.rateSet).reason}
            </p>
            <ParameterSummary draft={validated} />
            <RuleDifferences
              differences={comparePayrollRules(baseline, validated.rateSet)}
            />
            <RulePreview draft={validated} />
            <button
              type="button"
              className="btn"
              onClick={() =>
                download("payroll-rule-working-copy.json", {
                  format: "societyer-payroll-rules",
                  version: 1,
                  draft: validated,
                })
              }
            >
              Export validated working JSON
            </button>
          </div>
        )}
      </form>
      <details>
        <summary>Import structured rate JSON</summary>
        <Field label="Payroll rule JSON">
          <textarea
            className="input"
            rows={10}
            value={json}
            onChange={(event) => {
              setJson(event.target.value);
              setValidated(undefined);
            }}
          />
        </Field>
        <button
          className="btn"
          type="button"
          onClick={() => {
            try {
              if (new TextEncoder().encode(json).length > 150000)
                throw new Error(
                  "Import at most150 KB of structured rate data.",
                );
              const value = JSON.parse(json);
              if (
                value?.format === "societyer-payroll-rules" &&
                value.version !== 1
              )
                throw new Error("Unsupported rule import version.");
              const draft = cleanPayrollRuleDraft(
                value?.format === "societyer-payroll-rules"
                  ? value.draft
                  : value,
              );
              onLoad(draft);
            } catch (cause) {
              setError(payrollFailure(cause));
            }
          }}
        >
          Load JSON into editor
        </button>
        <p>
          Loading JSON creates editable data only. It does not publish rules or
          execute imported formulas.
        </p>
      </details>
    </section>
  );
}
function ParameterSummary({ draft }: { draft: PayrollRuleDraft }) {
  return (
    <div>
      <p>
        CPP {payrollPercentDisplay(draft.rateSet.cpp.rate)}% · CPP2{" "}
        {payrollPercentDisplay(draft.rateSet.cpp.secondRate)}% · EI{" "}
        {payrollPercentDisplay(draft.rateSet.ei.rate)}% · annual CPP maximum{" "}
        <Money cents={draft.rateSet.cpp.maximumCents} currency="CAD" /> · EI
        maximum <Money cents={draft.rateSet.ei.maximumCents} currency="CAD" />.
      </p>
      <ul>
        {draft.sourceEvidence.map((source, index) => (
          <li key={`${source.url}:${index}`}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.authority}: {source.title}
            </a>{" "}
            · reviewed {source.reviewedOn}
            <p>{source.notes}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
function RuleDifferences({
  differences,
}: {
  differences: ReturnType<typeof comparePayrollRules>;
}) {
  return (
    <details>
      <summary>
        Compare with the archived official baseline ({differences.length}{" "}
        changed fields)
      </summary>
      {differences.length ? (
        <div className="payroll-calculator__table-wrap">
          <table className="table" aria-label="Payroll rule changes">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Baseline value</th>
                <th>Working value</th>
              </tr>
            </thead>
            <tbody>
              {differences.map((value) => (
                <tr key={value.path}>
                  <th>{value.path}</th>
                  <td>
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(value.before)}
                    </pre>
                  </td>
                  <td>
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(value.after)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No rate parameter changes.</p>
      )}
    </details>
  );
}
function RulePreview({ draft }: { draft: PayrollRuleDraft }) {
  try {
    const input = {
      payDate: draft.rateSet.effectiveFrom,
      provinceOfEmployment: "BC",
      method: draft.rateSet.method as "option1" | "option2",
      payPeriodsPerYear: 26,
      periodNumber: 1,
      regular: {
        cashCents: 500000,
        taxableCents: 500000,
        pensionableCents: 500000,
        insurableCents: 500000,
      },
      ytd: emptyPayrollYtd(),
      ytdConfirmed: true,
      td1: { confirmed: true },
      cpp: { eligible: true, contributionMonths: 12 },
      ei: { exempt: false },
    };
    const result = calculatePayrollDeductions(input, {
      rateSet: draft.rateSet,
    });
    const original = calculatePayrollDeductions(input);
    return (
      <section aria-label="Rule calculation comparison">
        <h4>Example deduction comparison</h4>
        <p>
          CAD5,000 regular cash/taxable/pensionable/insurable pay, 26 pays,
          period1, zero same-employer YTD and default TD1 claims. This is an
          illustration; actual payroll uses the selected employee’s declarations
          and balances.
        </p>
        <div
          className="payroll-calculator__table-wrap"
          role="region"
          aria-label="Rule calculation comparison table"
          tabIndex={0}
        >
          <table className="table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Built-in edition</th>
                <th>Working edition</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Employee CPP", "cppEmployeeCents"],
                  ["Employee CPP2", "cpp2EmployeeCents"],
                  ["Employee EI", "eiEmployeeCents"],
                  ["Income tax", "incomeTaxCents"],
                  ["Net cash", "netCashCents"],
                ] as const
              ).map(([label, key]) => (
                <tr key={key}>
                  <th>{label}</th>
                  <td>
                    <Money cents={original[key]} currency="CAD" />
                  </td>
                  <td>
                    <Money cents={result[key]} currency="CAD" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  } catch (cause) {
    return (
      <p role="status">
        Calculation preview unavailable: {payrollFailure(cause)}
      </p>
    );
  }
}
