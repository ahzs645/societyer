import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUser, useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FileSearch,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  ShieldAlert,
  Tag,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { formatDate } from "../lib/format";

const CREDENTIAL_TYPES = ["recovery_key", "registry_key", "api_key", "password", "certificate", "other"];
const STORAGE_MODES = ["stored_encrypted", "external_reference", "encrypted_elsewhere", "not_stored"];
const STATUSES = ["NeedsReview", "Active", "Rotated", "Revoked"];
const REVEAL_POLICIES = [
  { value: "owner_admin_custodian", label: "Owners, admins, and custodian" },
  { value: "owner_admin", label: "Owners and admins" },
  { value: "owner_only", label: "Owner only" },
];

const FIELDS: FilterField<any>[] = [
  { id: "status", label: "Status", icon: <Tag size={14} />, options: STATUSES, match: (r, q) => r.status === q },
  { id: "type", label: "Credential", icon: <KeyRound size={14} />, options: CREDENTIAL_TYPES, match: (r, q) => r.credentialType === q },
  { id: "storage", label: "Storage", icon: <ShieldAlert size={14} />, options: STORAGE_MODES, match: (r, q) => r.storageMode === q },
  {
    id: "custodian",
    label: "Custodian",
    icon: <UserRound size={14} />,
    options: ["Assigned", "Unassigned"],
    match: (r, q) => q === "Assigned" ? Boolean(r.custodianPersonName || r.custodianUserId) : !r.custodianPersonName && !r.custodianUserId,
  },
];

export function SecretsPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const currentUser = useCurrentUser();
  const items = useQuery(api.secrets.list, society ? { societyId: society._id } : "skip");
  const users = useQuery(api.users.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.secrets.create);
  const update = useMutation(api.secrets.update);
  const revealSecret = useMutation(api.secrets.revealSecret);
  const remove = useMutation(api.secrets.remove);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(null);
  const [showDraftSecret, setShowDraftSecret] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState("");
  const [showRevealedSecret, setShowRevealedSecret] = useState(false);
  const [error, setError] = useState("");

  const rows = (items ?? []) as any[];
  const people = useMemo(
    () => (users ?? []).map((user: any) => ({
      id: user._id,
      label: `${user.displayName} (${user.role})`,
      name: user.displayName,
      email: user.email,
      role: user.role,
    })),
    [users],
  );
  const summary = useMemo(() => summarize(rows), [rows]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setEditingId(null);
    setRevealedSecret("");
    setShowDraftSecret(false);
    setShowRevealedSecret(false);
    setError("");
    setForm({
      name: "",
      service: "",
      credentialType: "other",
      ownerRole: "Administrator",
      custodianUserId: "",
      custodianPersonName: "",
      custodianEmail: "",
      backupCustodianName: "",
      backupCustodianEmail: "",
      storageMode: "stored_encrypted",
      externalLocation: "",
      secretValue: "",
      revealPolicy: "owner_admin_custodian",
      status: "NeedsReview",
      sensitivity: "high",
      accessLevel: "restricted",
      notes: "",
    });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditingId(row._id);
    setRevealedSecret("");
    setShowDraftSecret(false);
    setShowRevealedSecret(false);
    setError("");
    setForm({
      name: row.name ?? "",
      service: row.service ?? "",
      credentialType: row.credentialType ?? "other",
      ownerRole: row.ownerRole ?? "",
      custodianUserId: row.custodianUserId ?? "",
      custodianPersonName: row.custodianPersonName ?? "",
      custodianEmail: row.custodianEmail ?? "",
      backupCustodianName: row.backupCustodianName ?? "",
      backupCustodianEmail: row.backupCustodianEmail ?? "",
      username: row.username ?? "",
      accessUrl: row.accessUrl ?? "",
      storageMode: row.storageMode ?? "external_reference",
      externalLocation: row.externalLocation ?? "",
      secretValue: "",
      secretPreview: row.secretPreview ?? "",
      hasSecretValue: row.hasSecretValue ?? false,
      secretLastRevealedAtISO: row.secretLastRevealedAtISO ?? "",
      revealPolicy: row.revealPolicy ?? "owner_admin_custodian",
      lastVerifiedAtISO: row.lastVerifiedAtISO ?? "",
      rotationDueAtISO: row.rotationDueAtISO ?? "",
      status: row.status ?? "NeedsReview",
      sensitivity: row.sensitivity ?? "restricted",
      accessLevel: row.accessLevel ?? "restricted",
      sourceDocumentIds: row.sourceDocumentIds,
      sourceExternalIds: row.sourceExternalIds,
      notes: row.notes ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      setError("");
      const payload = normalizeDraft(form);
      if (editingId) {
        await update({ id: editingId as any, actingUserId, patch: payload });
      } else {
        await create({ societyId: society._id, actingUserId, ...payload });
      }
      setOpen(false);
    } catch (err: any) {
      setError(err?.data?.message ?? err?.message ?? "Could not save this access record.");
    }
  };

  const revealStoredSecret = async () => {
    if (!editingId || !actingUserId) return;
    try {
      setError("");
      const result = await revealSecret({ id: editingId as any, actingUserId });
      setRevealedSecret(result.value);
      setShowRevealedSecret(true);
    } catch (err: any) {
      setError(err?.data?.message ?? err?.message ?? "Could not reveal this value.");
    }
  };

  const selectCustodian = (id: string) => {
    const person = people.find((option) => option.id === id);
    setForm({
      ...form,
      custodianUserId: id,
      custodianPersonName: person?.name ?? form.custodianPersonName ?? "",
      custodianEmail: person?.email ?? form.custodianEmail ?? "",
      ownerRole: person?.role ?? form.ownerRole ?? "",
    });
  };

  return (
    <div className="page">
      <PageHeader
        title="Access custody"
        icon={<LockKeyhole size={16} />}
        iconColor="red"
        subtitle="Credential ownership, recovery-key custody, access review, and rotation tracking."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn-action" to="/app/users"><UsersRound size={12} /> People</Link>
            <Link className="btn-action" to="/app/imports"><FileSearch size={12} /> Review imports</Link>
            <button className="btn-action btn-action--primary" onClick={openNew}><Plus size={12} /> New access record</button>
          </div>
        }
      />

      <div className="stat-grid">
        <Stat label="Records" value={summary.total} sub="credential references" />
        <Stat label="Stored values" value={summary.stored} sub="encrypted in Societyer" />
        <Stat label="Needs review" value={summary.needsReview} sub="pending owner check" tone={summary.needsReview > 0 ? "warn" : undefined} />
        <Stat label="Rotation due" value={summary.rotationDue} sub="within 30 days or late" tone={summary.rotationDue > 0 ? "warn" : undefined} />
      </div>

      <div className="flag flag--warn" style={{ marginBottom: 16 }}>
        <ShieldAlert size={14} />
        <div>
          <strong>Stored values are encrypted and hidden by default.</strong>
          <div>Only authorized users can reveal a value. Every reveal is logged in the activity trail.</div>
        </div>
      </div>

      <DataTable
        label="Access records"
        icon={<LockKeyhole size={14} />}
        data={rows}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search service, custodian, account..."
        searchExtraFields={[
          (r) => r.custodianPersonName,
          (r) => r.custodianEmail,
          (r) => r.backupCustodianName,
          (r) => r.ownerRole,
          (r) => r.notes,
          (r) => r.username,
          (r) => r.externalLocation,
        ]}
        defaultSort={{ columnId: "status", dir: "asc" }}
        emptyMessage="No access custody records yet."
        onRowClick={openEdit}
        rowActionLabel={(r) => `Open access custody record ${r.name}`}
        columns={[
          {
            id: "name",
            header: "Record",
            sortable: true,
            accessor: (r) => r.name,
            render: (r) => (
              <div>
                <strong>{r.name}</strong>
                <div className="muted">{r.service || "Service not set"}</div>
              </div>
            ),
          },
          { id: "credentialType", header: "Credential", sortable: true, accessor: (r) => r.credentialType, render: (r) => <span className="cell-tag">{typeLabel(r.credentialType)}</span> },
          {
            id: "custodian",
            header: "Custodian",
            sortable: true,
            accessor: (r) => r.custodianPersonName ?? r.ownerRole ?? "",
            render: (r) => r.custodianPersonName ? (
              <div>
                <strong>{r.custodianPersonName}</strong>
                <div className="muted">{r.ownerRole || r.custodianEmail || "Responsible person"}</div>
              </div>
            ) : (
              <Badge tone="danger">Unassigned</Badge>
            ),
          },
          { id: "value", header: "Value", sortable: true, accessor: (r) => Boolean(r.hasSecretValue), render: (r) => r.hasSecretValue ? <Badge tone="success">{r.secretPreview || "Stored"}</Badge> : <Badge tone="warn">External only</Badge> },
          { id: "storageMode", header: "Storage", sortable: true, accessor: (r) => r.storageMode, render: (r) => <Badge tone={storageTone(r.storageMode)}>{storageLabel(r.storageMode)}</Badge> },
          {
            id: "review",
            header: "Review",
            sortable: true,
            accessor: (r) => r.rotationDueAtISO ?? r.lastVerifiedAtISO ?? "",
            render: (r) => <ReviewCell row={r} />,
          },
          { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, render: (r) => <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge> },
          { id: "sources", header: "Sources", align: "right", accessor: (r) => r.sourceExternalIds?.length ?? 0, render: (r) => r.sourceExternalIds?.length ? <Badge tone="info">{r.sourceExternalIds.length}</Badge> : "—" },
        ]}
        renderRowActions={(r) => (
          <>
            <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Edit access custody record ${r.name}`} onClick={() => openEdit(r)}>
              <Pencil size={12} />
            </button>
            <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete access custody record ${r.name}`} onClick={() => remove({ id: r._id, actingUserId })}>
              <Trash2 size={12} />
            </button>
          </>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Edit access record" : "New access record"}
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            {error && <div className="flag flag--err" style={{ marginBottom: 12 }}><ShieldAlert size={14} /><div>{error}</div></div>}
            <div className="flag flag--ok" style={{ marginBottom: 12 }}>
              <CheckCircle2 size={14} />
              <div>Stored values stay hidden until an authorized user explicitly reveals them.</div>
            </div>

            <Field label="Record name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Service"><input className="input" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Credential type">
                <select className="input" value={form.credentialType} onChange={(e) => setForm({ ...form, credentialType: e.target.value })}>
                  {CREDENTIAL_TYPES.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUSES.map((status) => <option key={status}>{statusLabel(status)}</option>)}
                </select>
              </Field>
            </div>

            <div className="card" style={{ margin: "12px 0" }}>
              <div className="card__head">
                <UserRound size={14} />
                <h2 className="card__title">Custodian</h2>
              </div>
              <div className="card__body">
                <Field label="Linked user">
                  <select className="input" value={form.custodianUserId ?? ""} onChange={(e) => selectCustodian(e.target.value)}>
                    <option value="">Manual or external person</option>
                    {people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
                  </select>
                </Field>
                <Field label="Primary custodian"><input className="input" value={form.custodianPersonName ?? ""} onChange={(e) => setForm({ ...form, custodianUserId: "", custodianPersonName: e.target.value })} /></Field>
                <Field label="Custodian email"><input className="input" type="email" value={form.custodianEmail ?? ""} onChange={(e) => setForm({ ...form, custodianEmail: e.target.value })} /></Field>
                <Field label="Role"><input className="input" value={form.ownerRole ?? ""} onChange={(e) => setForm({ ...form, ownerRole: e.target.value })} /></Field>
                <Field label="Backup custodian"><input className="input" value={form.backupCustodianName ?? ""} onChange={(e) => setForm({ ...form, backupCustodianName: e.target.value })} /></Field>
                <Field label="Backup email"><input className="input" type="email" value={form.backupCustodianEmail ?? ""} onChange={(e) => setForm({ ...form, backupCustodianEmail: e.target.value })} /></Field>
              </div>
            </div>

            <div className="row" style={{ gap: 12 }}>
              <Field label="Storage">
                <select className="input" value={form.storageMode} onChange={(e) => setForm({ ...form, storageMode: e.target.value })}>
                  {STORAGE_MODES.map((mode) => <option key={mode} value={mode}>{storageLabel(mode)}</option>)}
                </select>
              </Field>
              <Field label="Vault record / location"><input className="input" value={form.externalLocation ?? ""} onChange={(e) => setForm({ ...form, externalLocation: e.target.value })} /></Field>
            </div>
            <div className="card" style={{ margin: "12px 0" }}>
              <div className="card__head">
                <LockKeyhole size={14} />
                <h2 className="card__title">Stored value</h2>
                {form.hasSecretValue && <span className="card__subtitle">Current: {form.secretPreview || "stored"}</span>}
              </div>
              <div className="card__body">
                <Field id="secret-value" label={editingId ? "Replace value" : "Value"} hint="Hidden by default">
                  <input
                    className="input"
                    type={showDraftSecret ? "text" : "password"}
                    autoComplete="new-password"
                    value={form.secretValue ?? ""}
                    onChange={(e) => setForm({ ...form, secretValue: e.target.value, storageMode: e.target.value ? "stored_encrypted" : form.storageMode })}
                  />
                </Field>
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => setShowDraftSecret((value) => !value)}>
                  {showDraftSecret ? <EyeOff size={12} /> : <Eye size={12} />} {showDraftSecret ? "Hide typed value" : "Show typed value"}
                </button>
                {editingId && form.hasSecretValue && !revealedSecret && (
                  <Field id="revealed-secret-value" label="Reveal stored value" hint={form.secretLastRevealedAtISO ? `Last revealed ${formatDate(form.secretLastRevealedAtISO)}` : undefined}>
                    <button className="btn btn--ghost btn--sm" type="button" onClick={revealStoredSecret} disabled={!actingUserId}>
                      <Eye size={12} /> Reveal
                    </button>
                  </Field>
                )}
                {editingId && form.hasSecretValue && revealedSecret && (
                  <>
                    <Field id="revealed-secret-value" label="Reveal stored value" hint={form.secretLastRevealedAtISO ? `Last revealed ${formatDate(form.secretLastRevealedAtISO)}` : undefined}>
                      <input className="input mono" readOnly type={showRevealedSecret ? "text" : "password"} value={revealedSecret} />
                    </Field>
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <button className="btn btn--ghost btn--icon" type="button" aria-label={showRevealedSecret ? "Hide revealed value" : "Show revealed value"} onClick={() => setShowRevealedSecret((value) => !value)}>
                        {showRevealedSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button className="btn btn--ghost btn--icon" type="button" aria-label="Copy revealed value" onClick={() => navigator.clipboard?.writeText(revealedSecret)}>
                        <Copy size={14} />
                      </button>
                    </div>
                  </>
                )}
                <Field label="Reveal access">
                  <select className="input" value={form.revealPolicy ?? "owner_admin_custodian"} onChange={(e) => setForm({ ...form, revealPolicy: e.target.value })}>
                    {REVEAL_POLICIES.map((policy) => <option key={policy.value} value={policy.value}>{policy.label}</option>)}
                  </select>
                </Field>
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  Acting user: {currentUser?.displayName ?? "not selected"}. Save access requires Admin or Owner.
                </div>
              </div>
            </div>
            <Field label="Account username"><input className="input" value={form.username ?? ""} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label="Access URL"><input className="input" value={form.accessUrl ?? ""} onChange={(e) => setForm({ ...form, accessUrl: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Last reviewed"><input className="input" type="date" value={form.lastVerifiedAtISO ?? ""} onChange={(e) => setForm({ ...form, lastVerifiedAtISO: e.target.value })} /></Field>
              <Field label="Next review"><input className="input" type="date" value={form.rotationDueAtISO ?? ""} onChange={(e) => setForm({ ...form, rotationDueAtISO: e.target.value })} /></Field>
            </div>
            <Field label="Notes"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: "warn" | "danger" }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={tone ? { color: tone === "danger" ? "var(--danger)" : "var(--warn)" } : undefined}>{value}</div>
      <div className="stat__sub">{sub}</div>
    </div>
  );
}

function ReviewCell({ row }: { row: any }) {
  if (!row.rotationDueAtISO && !row.lastVerifiedAtISO) return <Badge tone="warn">Not scheduled</Badge>;
  const due = reviewDue(row.rotationDueAtISO);
  if (due === "late") return <Badge tone="danger">Overdue {formatDate(row.rotationDueAtISO)}</Badge>;
  if (due === "soon") return <Badge tone="warn">Due {formatDate(row.rotationDueAtISO)}</Badge>;
  return (
    <div>
      <span className="mono">{formatDate(row.rotationDueAtISO ?? row.lastVerifiedAtISO)}</span>
      {row.lastVerifiedAtISO && <div className="muted">Reviewed {formatDate(row.lastVerifiedAtISO)}</div>}
    </div>
  );
}

function summarize(rows: any[]) {
  return {
    total: rows.length,
    stored: rows.filter((row) => row.hasSecretValue).length,
    needsReview: rows.filter((row) => row.status === "NeedsReview").length,
    unassigned: rows.filter((row) => !row.custodianPersonName && !row.custodianUserId).length,
    rotationDue: rows.filter((row) => ["late", "soon"].includes(reviewDue(row.rotationDueAtISO))).length,
  };
}

function normalizeDraft(form: any) {
  const {
    custodianUserId,
    hasSecretValue,
    secretPreview,
    secretLastRevealedAtISO,
    ...rest
  } = form ?? {};
  const payload = { ...rest };
  if (custodianUserId) payload.custodianUserId = custodianUserId;
  if (!payload.secretValue) delete payload.secretValue;
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== ""),
  );
}

function reviewDue(value?: string) {
  if (!value) return "none";
  const days = Math.floor((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "late";
  if (days <= 30) return "soon";
  return "later";
}

function typeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function storageLabel(value: string) {
  if (value === "stored_encrypted") return "Stored encrypted";
  if (value === "external_reference") return "External vault reference";
  if (value === "encrypted_elsewhere") return "Encrypted outside Societyer";
  if (value === "not_stored") return "Not retained";
  return typeLabel(value);
}

function storageTone(value: string): "neutral" | "success" | "warn" {
  if (value === "stored_encrypted" || value === "encrypted_elsewhere") return "success";
  if (value === "not_stored") return "warn";
  return "neutral";
}

function statusLabel(status: string) {
  if (status === "NeedsReview") return "Needs review";
  return status;
}

function statusTone(status: string): "success" | "warn" | "danger" | "neutral" {
  if (status === "Active") return "success";
  if (status === "Revoked") return "danger";
  if (status === "Rotated") return "neutral";
  return "warn";
}
