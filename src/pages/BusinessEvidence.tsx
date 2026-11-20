import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { businessRegisters, registerPermission, type EvidenceRegister, type EvidenceField } from "../../shared/businessEvidence";
import { evidenceRules } from "../../shared/businessEvidenceRules";
import type { GovernanceOrganization } from "../../shared/legalGovernanceProfiles";

interface Option { id: string; label: string }
type Choices = Record<string, Option[]>;
type NoticeParticulars = { company?: string; holder?: string; shareClass?: string; quantity?: number; issueOrTransferDate?: string };
interface EvidenceRow {
  particulars?: NoticeParticulars;
  _id: string; historical: boolean; recordedAt: string; documentId?: string; sourcePage?: number; documentMissing?: boolean;
  [key: string]: string | number | boolean | NoticeParticulars | undefined;
}

function displayValue(field: EvidenceField, value: unknown, choices: Choices) {
  if (value == null) return "";
  if (field.table) return choices[field.table]?.find(item => item.id === value)?.label ?? "Linked record unavailable";
  if (field.type === "money") return (Number(value) / 100).toFixed(2);
  return String(value);
}

function Register({ register, org, societyId }: { register: EvidenceRegister; org: GovernanceOrganization; societyId: string }) {
  const { can } = usePermissions();
  const args = { societyId, register: register.table };
  const records = useQuery(api.businessEvidence.list, args) as EvidenceRow[] | undefined;
  const choices = useQuery(api.businessEvidence.choices, args) as Choices | undefined;
  const docs = useQuery(api.documents.listSummaries, can("documents:read") ? { societyId } : "skip") as { _id: string; title: string }[] | undefined;
  const save = useMutation(api.businessEvidence.save);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [previousId, setPreviousId] = useState<string>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(false);
  const canWrite = can(registerPermission(register, "write"));
  const update = (key: string, value: string) => setDraft(old => ({ ...old, [key]: value }));
  const open = (row?: EvidenceRow) => {
    const values: Record<string, string> = {};
    for (const field of register.fields) {
      if (row?.[field.key] != null) values[field.key] = field.type === "money"
        ? displayValue(field, row[field.key], {}) : String(row[field.key]);
    }
    // A deleted supporting document can't be cited again; the revision starts without one.
    const documentId = row?.documentMissing ? "" : row?.documentId ?? "";
    setDraft({ ...values, documentId, sourcePage: documentId ? String(row?.sourcePage ?? "") : "" });
    setPreviousId(row?._id);
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || saving) return;
    // The pickers aren't native selects, so required choices are checked here.
    const missing = register.fields.find(field => field.required && (field.table || field.options) && !draft[field.key]);
    if (missing) { setError(`${missing.label} is required.`); return; }
    setSaving(true);
    try {
      const values: Record<string, string | number> = {};
      for (const field of register.fields) {
        const input = draft[field.key]?.trim();
        if (!input) continue;
        if (field.type === "money") values[field.key] = Math.round(Number(input) * 100);
        else if (field.type === "count") values[field.key] = Number(input);
        else values[field.key] = input;
      }
      await save({ ...args, values, previousId, documentId: draft.documentId || undefined,
        sourcePage: draft.documentId && draft.sourcePage ? Number(draft.sourcePage) : undefined });
      setDraft(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the record."); }
    finally { setSaving(false); }
  };
  const visible = records?.filter(row => history || !row.historical);
  return <>
    <section className="card">
      <div className="card__head">
        <h2 className="card__title">{register.label}</h2>
        {canWrite && <button className="btn btn--accent" onClick={() => open()}>Add record</button>}
      </div>
      <div className="card__body">
        {evidenceRules(org, register).sources.map(source => <p key={source.url}>{source.text} <a href={source.url} target="_blank" rel="noreferrer">{source.citation}</a></p>)}
        {!!records?.some(row => row.historical) && <label><input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} /> Show previous versions</label>}
        {visible === undefined ? <p>Loading records…</p> : !visible.length && <p>No records yet.</p>}
        {visible?.map(row => <article className="card" key={row._id}>
          <div className="card__body">
            {row.historical && <strong>Previous version</strong>}
            {row.particulars && <p>{[row.particulars.company, row.particulars.holder, row.particulars.shareClass,
              row.particulars.quantity != null ? String(row.particulars.quantity) + " shares" : undefined,
              row.particulars.issueOrTransferDate].filter(Boolean).join(" · ")}</p>}
            <dl>{register.fields.filter(field => row[field.key] != null).map(field => <div key={field.key}>
              <dt>{field.label}</dt><dd>{displayValue(field, row[field.key], choices ?? {})}</dd>
            </div>)}</dl>
            {row.documentMissing ? <p className="muted">Supporting document deleted{canWrite && !row.historical ? ". Revise the record to cite another document." : "."}</p>
              : row.documentId && <Link to={'/app/documents/' + row.documentId}>{docs?.find(doc => doc._id === row.documentId)?.title ?? "Supporting document"}{row.sourcePage && ' · p. ' + row.sourcePage}</Link>}
            {canWrite && !row.historical && <p><button className="btn btn--sm" onClick={() => open(row)}>Revise record</button></p>}
          </div>
        </article>)}
      </div>
    </section>
    <Drawer open={draft !== null} title={previousId ? "Revise record" : "Add record"} onClose={() => !saving && setDraft(null)}>
      {draft && <form onSubmit={submit}>
        {register.fields.map(field => {
          const options = field.table ? choices?.[field.table] ?? [] : field.options?.map(label => ({ label, id: label }));
          const type = ["date", "datetime-local"].includes(field.type) ? field.type : ["money", "count"].includes(field.type) ? "number" : "text";
          const props = { "aria-label": field.label, className: "input", required: field.required, value: draft[field.key] ?? "" };
          return <Field key={field.key} label={field.label}>{options
            ? <Select aria-label={field.label} value={draft[field.key] ?? ""} placeholder="Choose…" clearable={!field.required} clearLabel="None"
                searchable={field.table ? true : undefined}
                options={options.map(option => ({ value: option.id, label: option.label }))} onChange={value => update(field.key, value)} />
            : <input {...props} type={type} min={field.type === "money" ? 0 : field.type === "count" ? 1 : undefined} step={field.type === "money" ? "0.01" : undefined}
                maxLength={field.type === "last4" ? 4 : 2000} onChange={e => update(field.key, e.target.value)} />}</Field>;
        })}
        {can("documents:read") && <Field label="Supporting document"><Select aria-label="Supporting document" value={draft.documentId} placeholder="None" clearable clearLabel="None" searchable
          options={(docs ?? []).map(doc => ({ value: doc._id, label: doc.title }))} onChange={value => update("documentId", value)} /></Field>}
        {draft.documentId && <Field label="Source page"><input className="input" aria-label="Source page" type="number" min="1" value={draft.sourcePage} onChange={e => update("sourcePage", e.target.value)} /></Field>}
        {error && <p role="alert">{error}</p>}
        <button className="btn btn--accent" disabled={saving} type="submit">{saving ? "Saving…" : "Save record"}</button>
      </form>}
    </Drawer>
  </>;
}

export function BusinessEvidencePage() {
  const org = useSociety();
  const { can, loaded } = usePermissions();
  const [params, setParams] = useSearchParams();
  if (org === null) return <SeedPrompt />;
  if (!org || !loaded) return <PageLoading />;
  const available = businessRegisters.filter(register => can(registerPermission(register, "read")) && evidenceRules(org, register).available);
  const register = available.find(item => item.table === params.get("register")) ?? available[0];
  return <div className="page"><PageHeader title="Business records" />
    {register ? <>
      <Field label="Register"><Select aria-label="Register" value={register.table} onChange={table => setParams({ register: table })}
        options={available.map(item => ({ value: item.table, label: item.label }))} /></Field>
      <Register key={org._id + register.table} societyId={org._id} org={org} register={register} />
    </> : <p>No registers available for your role.</p>}
  </div>;
}
