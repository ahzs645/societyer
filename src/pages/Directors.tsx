import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, Flag, InspectorNote, RecordChip } from "../components/ui";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Plus, Trash2, UserCog, Tag, MapPin, CheckCircle2, CircleUser } from "lucide-react";
import { formatDate, initials } from "../lib/format";

const DIRECTOR_FIELDS: FilterField<any>[] = [
  { id: "name", label: "Name", icon: <CircleUser size={14} />, match: (d, q) => `${d.firstName} ${d.lastName} ${(d.aliases ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase()) },
  { id: "position", label: "Position", icon: <Tag size={14} />, options: ["President", "Vice President", "Treasurer", "Secretary", "Director"], match: (d, q) => d.position === q },
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Active", "Resigned", "Removed"], match: (d, q) => d.status === q },
  { id: "bc", label: "BC resident", icon: <MapPin size={14} />, options: ["Yes", "No"], match: (d, q) => (d.isBCResident ? "Yes" : "No") === q },
  { id: "consent", label: "Consent on file", icon: <CheckCircle2 size={14} />, options: ["Yes", "No"], match: (d, q) => (d.consentOnFile ? "Yes" : "No") === q },
];

export function DirectorsPage() {
  const society = useSociety();
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const orgHistory = useQuery(api.organizationHistory.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.directors.create);
  const update = useMutation(api.directors.update);
  const remove = useMutation(api.directors.remove);
  const confirm = useConfirm();
  const toast = useToast();
  const [selected, setSelected] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const active = (directors ?? []).filter((d: any) => d.status === "Active");
  const bcResidents = active.filter((d: any) => d.isBCResident).length;
  const missingConsent = active.filter((d: any) => !d.consentOnFile);
  const roleTerms = useMemo(() => {
    return (orgHistory?.boardTerms ?? [])
      .slice()
      .sort((a: any, b: any) => String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")));
  }, [orgHistory]);
  const legalDirectorTerms = roleTerms.filter((term: any) =>
    /director|president|treasurer|secretary|chair/i.test(`${term.position ?? ""} ${term.committeeName ?? ""}`),
  );
  const archivedRoleTerms = roleTerms.filter((term: any) => term.status === "Archived");
  const unresolvedRoleTerms = roleTerms.filter((term: any) => !["Archived", "Verified"].includes(term.status));

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setSelected({
      firstName: "", lastName: "", email: "",
      position: "Director", isBCResident: true,
      termStart: new Date().toISOString().slice(0, 10),
      consentOnFile: false, status: "Active", aliases: [],
    });
    setOpen(true);
  };

  const save = async () => {
    if (!selected) return;
    if (selected._id) {
      const { _id, _creationTime, societyId, ...patch } = selected;
      patch.aliases = cleanAliases(patch.aliases);
      await update({ id: _id, patch });
    } else {
      await create({ societyId: society._id, ...selected, aliases: cleanAliases(selected.aliases) });
    }
    setOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Directors"
        icon={<UserCog size={16} />}
        iconColor="blue"
        subtitle="Register of directors under s.20. Act requires ≥ 3 directors, ≥ 1 BC resident (regular societies)."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New director
          </button>
        }
      />

      <div className="stat-grid">
        <div className="stat">
          <div className="stat__label">Active directors</div>
          <div className="stat__value" style={{ color: active.length < 3 && !society.isMemberFunded ? "var(--danger)" : undefined }}>{active.length}</div>
          <div className="stat__sub">Minimum 3 for regular societies.</div>
        </div>
        <div className="stat">
          <div className="stat__label">BC residents</div>
          <div className="stat__value" style={{ color: bcResidents < 1 ? "var(--danger)" : undefined }}>{bcResidents}</div>
          <div className="stat__sub">At least one BC resident required.</div>
        </div>
        <div className="stat">
          <div className="stat__label">Consent on file</div>
          <div className="stat__value" style={{ color: missingConsent.length ? "var(--warn)" : undefined }}>{active.length - missingConsent.length}/{active.length}</div>
          <div className="stat__sub">Written consent required to act.</div>
        </div>
        <div className="stat">
          <div className="stat__label">Change of directors</div>
          <div className="stat__value">30d</div>
          <div className="stat__sub">File within 30 days via Societies Online.</div>
        </div>
      </div>

      {(active.length < 3 || bcResidents < 1 || missingConsent.length > 0) && (
        <div className="col" style={{ marginBottom: 16, gap: 6 }}>
          {active.length < 3 && !society.isMemberFunded && <Flag level="err">Fewer than 3 active directors — regular societies must have at least 3.</Flag>}
          {bcResidents < 1 && <Flag level="err">No BC-resident director. At least one is required.</Flag>}
          {missingConsent.length > 0 && <Flag level="warn">{missingConsent.length} director(s) without consent on file.</Flag>}
        </div>
      )}

      <DataTable
        label="Current legal director register"
        icon={<UserCog size={14} />}
        data={(directors ?? []) as any[]}
        loading={directors === undefined}
        rowKey={(r) => r._id}
        filterFields={DIRECTOR_FIELDS}
        searchPlaceholder="Search directors…"
        defaultSort={{ columnId: "name", dir: "asc" }}
        onRowClick={(row) => { setSelected(row); setOpen(true); }}
        columns={[
          {
            id: "name", header: "Name", sortable: true,
            accessor: (r) => `${r.firstName} ${r.lastName}`,
            render: (r) => (
              <RecordChip
                tone="blue"
                avatar={initials(r.firstName, r.lastName)}
                label={`${r.firstName} ${r.lastName}`}
              />
            ),
          },
          {
            id: "position", header: "Position", sortable: true,
            accessor: (r) => r.position,
            render: (r) => <span className="cell-tag">{r.position}</span>,
          },
          {
            id: "termStart", header: "Term start", sortable: true,
            accessor: (r) => r.termStart,
            render: (r) => <span className="mono">{formatDate(r.termStart)}</span>,
          },
          {
            id: "bc", header: "BC resident", sortable: true,
            accessor: (r) => (r.isBCResident ? 1 : 0),
            render: (r) => r.isBCResident ? <Badge tone="success">Yes</Badge> : <Badge tone="warn">No</Badge>,
          },
          {
            id: "consent", header: "Consent", sortable: true,
            accessor: (r) => (r.consentOnFile ? 1 : 0),
            render: (r) => r.consentOnFile ? <Badge tone="success">On file</Badge> : <Badge tone="danger">Missing</Badge>,
          },
          {
            id: "status", header: "Status", sortable: true,
            accessor: (r) => r.status,
            render: (r) => <Badge tone={r.status === "Active" ? "success" : "warn"}>{r.status}</Badge>,
          },
        ]}
        renderRowActions={(r) => (
          <button
            className="btn btn--ghost btn--sm btn--icon"
            aria-label={`Remove ${r.firstName} ${r.lastName}`}
            onClick={async () => {
              const ok = await confirm({
                title: "Remove director?",
                message: `${r.firstName} ${r.lastName} will be removed from the director register.`,
                confirmLabel: "Remove",
                tone: "danger",
              });
              if (!ok) return;
              await remove({ id: r._id });
              toast.success("Director removed");
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      />

      {roleTerms.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card__head">
            <div>
              <h2 className="card__title">Archived role and service evidence</h2>
              <p className="card__subtitle">
                Paperless-derived board, director, masthead, and editorial records retained as historical evidence. The legal register above is the definitive current board.
              </p>
            </div>
            <Link className="btn-action" to="/app/org-history">
              Open history
            </Link>
          </div>
          <div className="card__body">
            <div className="stat-grid" style={{ marginBottom: 12 }}>
              <div className="stat">
                <div className="stat__label">Historical roles</div>
                <div className="stat__value">{roleTerms.length}</div>
                <div className="stat__sub">board, director, masthead, staff</div>
              </div>
              <div className="stat">
                <div className="stat__label">Director/officer evidence</div>
                <div className="stat__value">{legalDirectorTerms.length}</div>
                <div className="stat__sub">archived historical observations</div>
              </div>
              <div className="stat">
                <div className="stat__label">Archived</div>
                <div className="stat__value">{archivedRoleTerms.length}</div>
                <div className="stat__sub">kept for audit trail</div>
              </div>
              <div className="stat">
                <div className="stat__label">Unresolved</div>
                <div className="stat__value">{unresolvedRoleTerms.length}</div>
                <div className="stat__sub">source needs cleanup</div>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr><th>Person</th><th>Position</th><th>Board/group</th><th>Observed</th><th>Status</th></tr>
              </thead>
              <tbody>
                {roleTerms.slice(0, 12).map((term: any) => (
                  <tr key={term._id}>
                    <td><strong>{term.personName}</strong></td>
                    <td>{term.position}</td>
                    <td className="muted">{term.committeeName ?? "—"}</td>
                    <td className="mono">{formatDate(term.startDate ?? term.endDate)}</td>
                    <td><Badge tone={roleStatusTone(term.status)}>{term.status ?? "Needs Review"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={selected?._id ? "Edit director" : "Add director"}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Save</button>
          </>
        }
      >
        {selected && (
          <div>
            <InspectorNote tone="warn" title="Director register">
              Keep this register current. Changes to directors normally need to be reflected in your
              filing workflow within 30 days.
            </InspectorNote>
            <div className="row" style={{ gap: 12 }}>
              <Field label="First name"><input className="input" value={selected.firstName} onChange={(e) => setSelected({ ...selected, firstName: e.target.value })} /></Field>
              <Field label="Last name"><input className="input" value={selected.lastName} onChange={(e) => setSelected({ ...selected, lastName: e.target.value })} /></Field>
            </div>
            <Field label="Email"><input className="input" value={selected.email ?? ""} onChange={(e) => setSelected({ ...selected, email: e.target.value })} /></Field>
            <Field label="Aliases">
              <input
                className="input"
                value={(selected.aliases ?? []).join(", ")}
                onChange={(e) => setSelected({ ...selected, aliases: e.target.value.split(",") })}
                placeholder="Bruce Danesh, Behrouz (Bruce) Danesh"
              />
            </Field>
            <Field label="Linked member">
              <select
                className="input"
                value={selected.memberId ?? ""}
                onChange={(event) => setSelected({ ...selected, memberId: event.target.value || undefined })}
              >
                <option value="">No linked member</option>
                {(members ?? []).map((member: any) => (
                  <option key={member._id} value={member._id}>
                    {member.firstName} {member.lastName}
                    {member.email ? ` · ${member.email}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Position">
              <Select
                value={selected.position}
                onChange={(v) => setSelected({ ...selected, position: v })}
                options={["President", "Vice President", "Treasurer", "Secretary", "Director"].map((p) => ({ value: p, label: p }))}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Term start">
                <DatePicker value={selected.termStart} onChange={(v) => setSelected({ ...selected, termStart: v })} />
              </Field>
              <Field label="Term end">
                <DatePicker value={selected.termEnd ?? ""} onChange={(v) => setSelected({ ...selected, termEnd: v })} />
              </Field>
              <Field label="Status">
                <Select
                  value={selected.status}
                  onChange={(v) => setSelected({ ...selected, status: v })}
                  options={["Active", "Resigned", "Removed"].map((s) => ({ value: s, label: s }))}
                />
              </Field>
            </div>
            <Checkbox
              checked={!!selected.isBCResident}
              onChange={(v) => setSelected({ ...selected, isBCResident: v })}
              label="BC resident"
            />
            <Checkbox
              checked={!!selected.consentOnFile}
              onChange={(v) => setSelected({ ...selected, consentOnFile: v })}
              label="Written consent to act on file"
            />
            <Field label="Notes"><textarea className="textarea" value={selected.notes ?? ""} onChange={(e) => setSelected({ ...selected, notes: e.target.value })} /></Field>
            {selected._id && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
                <CustomFieldsPanel
                  societyId={society._id}
                  entityType="directors"
                  entityId={selected._id}
                />
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function cleanAliases(value: unknown) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(new Set(items.map((item) => String(item).trim()).filter(Boolean)));
}

function roleStatusTone(status?: string) {
  if (status === "Verified") return "success";
  if (status === "NeedsReview") return "warn";
  return "neutral";
}
