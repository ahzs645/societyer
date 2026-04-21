import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Toggle } from "../components/Controls";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { FileText, Plus, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";

export function PoliciesPage() {
  const society = useSociety();
  const policies = useQuery(api.policies.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.policies.upsert);
  const remove = useMutation(api.policies.remove);
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  const docById = useMemo(
    () => new Map<string, any>((documents ?? []).map((doc: any) => [doc._id, doc])),
    [documents],
  );

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setDraft({
      policyName: "",
      status: "Draft",
      signatureRequired: false,
      requiredSignersText: "",
      jurisdictionsText: "CA-BC",
      entityTypesText: "society",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft) return;
    await upsert({
      id: draft._id,
      societyId: society._id,
      policyName: draft.policyName || "Untitled policy",
      policyNumber: draft.policyNumber || undefined,
      owner: draft.owner || undefined,
      effectiveDate: draft.effectiveDate || undefined,
      reviewDate: draft.reviewDate || undefined,
      ceasedDate: draft.ceasedDate || undefined,
      docxDocumentId: draft.docxDocumentId || undefined,
      pdfDocumentId: draft.pdfDocumentId || undefined,
      html: draft.html || undefined,
      requiredSigners: csv(draft.requiredSignersText ?? draft.requiredSigners),
      signatureRequired: !!draft.signatureRequired,
      jurisdictions: csv(draft.jurisdictionsText ?? draft.jurisdictions),
      entityTypes: csv(draft.entityTypesText ?? draft.entityTypes),
      status: draft.status || "Draft",
      notes: draft.notes || undefined,
    });
    setOpen(false);
    setDraft(null);
    toast.success("Policy saved");
  };

  const confirmDelete = async (row: any) => {
    const ok = await confirm({
      title: "Delete policy?",
      message: `"${row.policyName}" will be removed from the policy registry.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remove({ id: row._id });
    toast.success("Policy deleted");
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="Policy registry"
        icon={<FileText size={16} />}
        iconColor="green"
        subtitle="First-class policy records with source documents, review dates, signers, jurisdictions, and entity scope."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New policy
          </button>
        }
      />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Policies</h2>
          <Badge>{policies?.length ?? 0}</Badge>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Owner</th>
                <th>Dates</th>
                <th>Documents</th>
                <th>Signers</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(policies ?? []).map((row: any) => (
                <tr key={row._id}>
                  <td>
                    <strong>{row.policyName}</strong>
                    {row.policyNumber && <div className="mono muted">{row.policyNumber}</div>}
                  </td>
                  <td>{row.owner || "-"}</td>
                  <td>
                    <div>{row.effectiveDate ? formatDate(row.effectiveDate) : "No effective date"}</div>
                    <div className="muted">{row.reviewDate ? `Review ${formatDate(row.reviewDate)}` : "No review date"}</div>
                  </td>
                  <td>
                    <div>{row.docxDocumentId ? docById.get(row.docxDocumentId)?.title ?? "DOCX linked" : "No DOCX"}</div>
                    <div className="muted">{row.pdfDocumentId ? docById.get(row.pdfDocumentId)?.title ?? "PDF linked" : "No PDF"}</div>
                  </td>
                  <td>
                    {row.signatureRequired ? (
                      <Badge tone="warn">{row.requiredSigners?.length || 0} required</Badge>
                    ) : (
                      <span className="muted">Not required</span>
                    )}
                  </td>
                  <td><Badge tone={toneForStatus(row.status)}>{row.status}</Badge></td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          setDraft({
                            ...row,
                            requiredSignersText: (row.requiredSigners ?? []).join(", "),
                            jurisdictionsText: (row.jurisdictions ?? []).join(", "),
                            entityTypesText: (row.entityTypes ?? []).join(", "),
                          });
                          setOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button className="btn btn--ghost btn--sm btn--icon" aria-label="Delete policy" onClick={() => confirmDelete(row)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(policies ?? []).length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No policies yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={open}
        onClose={() => { setOpen(false); setDraft(null); }}
        title={draft?._id ? "Edit policy" : "New policy"}
        footer={
          <>
            <button className="btn" onClick={() => { setOpen(false); setDraft(null); }}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Save</button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="Policy name"><input className="input" value={draft.policyName ?? ""} onChange={(e) => setDraft({ ...draft, policyName: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Policy number"><input className="input" value={draft.policyNumber ?? ""} onChange={(e) => setDraft({ ...draft, policyNumber: e.target.value })} /></Field>
              <Field label="Owner"><input className="input" value={draft.owner ?? ""} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Effective date"><DatePicker value={draft.effectiveDate ?? ""} onChange={(value) => setDraft({ ...draft, effectiveDate: value })} /></Field>
              <Field label="Review date"><DatePicker value={draft.reviewDate ?? ""} onChange={(value) => setDraft({ ...draft, reviewDate: value })} /></Field>
              <Field label="Ceased date"><DatePicker value={draft.ceasedDate ?? ""} onChange={(value) => setDraft({ ...draft, ceasedDate: value })} /></Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status"><input className="input" value={draft.status ?? ""} onChange={(e) => setDraft({ ...draft, status: e.target.value })} /></Field>
              <Field label="Jurisdictions"><input className="input" value={draft.jurisdictionsText ?? ""} onChange={(e) => setDraft({ ...draft, jurisdictionsText: e.target.value })} /></Field>
              <Field label="Entity types"><input className="input" value={draft.entityTypesText ?? ""} onChange={(e) => setDraft({ ...draft, entityTypesText: e.target.value })} /></Field>
            </div>
            <Field label="DOCX document">
              <select className="input" value={draft.docxDocumentId ?? ""} onChange={(e) => setDraft({ ...draft, docxDocumentId: e.target.value || undefined })}>
                <option value="">No DOCX document</option>
                {(documents ?? []).map((doc: any) => <option key={doc._id} value={doc._id}>{doc.title}</option>)}
              </select>
            </Field>
            <Field label="PDF document">
              <select className="input" value={draft.pdfDocumentId ?? ""} onChange={(e) => setDraft({ ...draft, pdfDocumentId: e.target.value || undefined })}>
                <option value="">No PDF document</option>
                {(documents ?? []).map((doc: any) => <option key={doc._id} value={doc._id}>{doc.title}</option>)}
              </select>
            </Field>
            <Toggle checked={!!draft.signatureRequired} onChange={(value) => setDraft({ ...draft, signatureRequired: value })} label="Signature required" />
            <Field label="Required signers"><input className="input" value={draft.requiredSignersText ?? ""} onChange={(e) => setDraft({ ...draft, requiredSignersText: e.target.value })} placeholder="Chair, Secretary, Treasurer" /></Field>
            <Field label="HTML"><textarea className="textarea mono" value={draft.html ?? ""} onChange={(e) => setDraft({ ...draft, html: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="textarea" value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          </>
        )}
      </Drawer>
    </div>
  );
}

function csv(value: any) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function toneForStatus(status?: string) {
  const value = String(status ?? "").toLowerCase();
  if (value.includes("active") || value.includes("approved")) return "success" as const;
  if (value.includes("review") || value.includes("draft")) return "warn" as const;
  if (value.includes("ceased") || value.includes("superseded")) return "danger" as const;
  return "neutral" as const;
}
