import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { useToast } from "../components/Toast";
import { Plus, Calculator, Trash2, Share2, Copy } from "lucide-react";
import type { Id as ConvexId } from "../../convex/_generated/dataModel";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Auditor appointments. Metadata-driven table — the page still owns the
 * "New appointment" drawer because engagement-letter attachment needs a
 * document picker that doesn't fit the generic inline editor.
 */
export function AuditorsPage() {
  const society = useSociety();
  const items = useQuery(api.auditors.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.auditors.create);
  const update = useMutation(api.auditors.update);
  const remove = useMutation(api.auditors.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "auditorAppointment",
    viewId: currentViewId,
  });

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      firmName: "",
      engagementType: "ReviewEngagement",
      fiscalYear: new Date().getFullYear().toString(),
      appointedBy: "Directors",
      appointedAtISO: new Date().toISOString().slice(0, 10),
      independenceAttested: true,
      status: "Active",
    });
    setOpen(true);
  };
  const save = async () => {
    await create({ societyId: society._id, ...form });
    setOpen(false);
  };

  const records = (items ?? []) as any[];
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Auditor appointments"
        icon={<Calculator size={16} />}
        iconColor="green"
        subtitle="First auditor appointed by directors; subsequent appointments made by members at the AGM. Only independent CPAs or CPA firms may serve as auditors."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New appointment
          </button>
        }
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="auditor-appointment" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="auditors"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onUpdate={async ({ recordId, fieldName, value }) => {
            await update({
              id: recordId as Id<"auditorAppointments">,
              patch: { [fieldName]: value } as any,
            });
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Calculator size={14} />}
            label="All appointments"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || items === undefined}
            renderRowActions={(r) => (
              <button
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Delete auditor ${r.firmName}`}
                onClick={() => remove({ id: r._id })}
              >
                <Trash2 size={12} />
              </button>
            )}
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

      <div className="spacer-6" />
      <div className="hr" style={{ marginBottom: 16 }} />

      <p className="muted" style={{ marginBottom: 12 }}>
        External parties like auditors can be given limited portal access to specific records — configure that here.
      </p>
      <StakeholderPortalSection societyId={society._id} />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New auditor appointment"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Firm name"><input className="input" value={form.firmName} onChange={(e) => setForm({ ...form, firmName: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Engagement">
                <Select value={form.engagementType} onChange={(value) => setForm({ ...form, engagementType: value })}
                  options={[
                    { value: "Audit", label: "Audit" },
                    { value: "ReviewEngagement", label: "ReviewEngagement" },
                    { value: "CompilationEngagement", label: "CompilationEngagement" },
                  ]} />
              </Field>
              <Field label="Fiscal year"><input className="input" value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })} /></Field>
              <Field label="Appointed by">
                <Select value={form.appointedBy} onChange={(value) => setForm({ ...form, appointedBy: value })}
                  options={[
                    { value: "Directors", label: "Directors" },
                    { value: "Members", label: "Members" },
                  ]} />
              </Field>
            </div>
            <Field label="Appointed on"><DatePicker value={form.appointedAtISO} onChange={(value) => setForm({ ...form, appointedAtISO: value })} /></Field>
            <Field label="Engagement letter">
              <Select value={form.engagementLetterDocId ?? ""} onChange={(value) => setForm({ ...form, engagementLetterDocId: value || undefined })}
                options={[{ value: "", label: "— none —" }, ...(documents ?? []).map((d: any) => ({ value: d._id, label: d.title }))]} />
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={form.independenceAttested} onChange={(e) => setForm({ ...form, independenceAttested: e.target.checked })} /> Firm has confirmed independence from the society
            </label>
          </div>
        )}
      </Drawer>
    </div>
  );
}

const PORTAL_SCOPES: Array<{ key: string; label: string }> = [
  { key: "board", label: "Board of directors" },
  { key: "publications", label: "Publications" },
  { key: "documents", label: "Documents" },
];

/**
 * Token-scoped read-only portals for external parties (auditors, lawyers). The
 * grantor picks which sections the party can read and whether files download;
 * the token lives in the share URL and can be revoked at any time.
 */
function StakeholderPortalSection({ societyId }: { societyId: ConvexId<"societies"> }) {
  const toast = useToast();
  const portals = useQuery(api.partyPortals.list, { societyId });
  const create = useMutation(api.partyPortals.create);
  const revoke = useMutation(api.partyPortals.revoke);
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [scopes, setScopes] = useState<string[]>(["board", "publications"]);
  const [allowDownload, setAllowDownload] = useState(false);
  const [busy, setBusy] = useState(false);

  const portalUrl = (token: string) => `${window.location.origin}/portal/${token}`;
  const nowISO = new Date().toISOString();

  const toggleScope = (key: string) =>
    setScopes((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));

  const onCreate = async () => {
    if (!label.trim() || scopes.length === 0) {
      toast.warn("Add a party name and at least one section to share.");
      return;
    }
    setBusy(true);
    try {
      const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
      await create({ societyId, token, label: label.trim(), partyEmail: email.trim() || undefined, scopes, allowDownload });
      await navigator.clipboard.writeText(portalUrl(token)).catch(() => {});
      toast.success("Portal created", "The share link is copied to your clipboard.");
      setLabel("");
      setEmail("");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not create the portal");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(portalUrl(token));
      toast.success("Share link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  const statusOf = (p: any): string =>
    p.revokedAtISO ? "Revoked" : p.expiresAtISO && p.expiresAtISO < nowISO ? "Expired" : "Active";

  return (
    <div className="card">
      <div className="card__head">
        <h2 className="card__title"><Share2 size={14} style={{ display: "inline-block", marginRight: 6, verticalAlign: -2 }} />Stakeholder portal access</h2>
        <span className="card__subtitle">Read-only rooms for auditors and other outside parties — no account needed</span>
      </div>
      <div className="card__body col" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Party name"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Smith & Co. (auditor)" /></Field>
          <Field label="Email (optional)"><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="auditor@firm.com" /></Field>
        </div>
        <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>Can read:</span>
          {PORTAL_SCOPES.map((s) => (
            <label key={s.key} className="checkbox" style={{ margin: 0 }}>
              <input type="checkbox" checked={scopes.includes(s.key)} onChange={() => toggleScope(s.key)} /> {s.label}
            </label>
          ))}
          <label className="checkbox" style={{ margin: 0 }}>
            <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} /> Allow downloads
          </label>
          <button className="btn btn--accent btn--sm" disabled={busy} onClick={onCreate}><Plus size={12} /> Create portal</button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Party</th><th>Shares</th><th>Downloads</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(portals ?? []).map((p: any) => (
                <tr key={p._id}>
                  <td><strong>{p.label}</strong>{p.partyEmail && <div className="muted">{p.partyEmail}</div>}</td>
                  <td>{(p.scopes ?? []).map((s: string) => PORTAL_SCOPES.find((x) => x.key === s)?.label ?? s).join(", ") || "—"}</td>
                  <td>{p.allowDownload ? "Yes" : "View-only"}</td>
                  <td>{statusOf(p)}</td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      {statusOf(p) === "Active" && (
                        <>
                          <button className="btn btn--ghost btn--sm" onClick={() => copyLink(p.token)}><Copy size={12} /> Link</button>
                          <button className="btn btn--ghost btn--sm" onClick={() => revoke({ id: p._id })}><Trash2 size={12} /> Revoke</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {(portals ?? []).length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 20 }}>No portals yet. Create one to share a read-only room.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
