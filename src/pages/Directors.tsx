import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, Flag, InspectorNote } from "../components/ui";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Archive, ListChecks, Plus, Trash2, UserCog } from "lucide-react";
import { formatDate } from "../lib/format";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  RecordTableBulkBar,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

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
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const [directorMode, setDirectorMode] = useState<"register" | "archived">("register");

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "director",
    viewId: currentViewId,
  });

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
  const currentDirectorKeys = new Set<string>(active.map((director: any) => personNameKey(`${director.firstName} ${director.lastName}`)));

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

  const records = (directors ?? []) as any[];
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Directors"
        icon={<UserCog size={16} />}
        iconColor="blue"
        subtitle="Register of directors under s.20. Section 40 requires >= 3 directors and >= 1 BC resident unless the s.197 member-funded exception applies."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <div className="segmented" role="tablist" aria-label="Director screen view">
              <button
                type="button"
                className={`segmented__btn${directorMode === "register" ? " is-active" : ""}`}
                aria-pressed={directorMode === "register"}
                onClick={() => setDirectorMode("register")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <ListChecks size={12} /> Register
              </button>
              <button
                type="button"
                className={`segmented__btn${directorMode === "archived" ? " is-active" : ""}`}
                aria-pressed={directorMode === "archived"}
                onClick={() => setDirectorMode("archived")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Archive size={12} /> Archived
              </button>
            </div>
            <button className="btn-action btn-action--primary" onClick={openNew}>
              <Plus size={12} /> New director
            </button>
          </div>
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
          <div className="stat__value" style={{ color: bcResidents < 1 && !society.isMemberFunded ? "var(--danger)" : undefined }}>{bcResidents}</div>
          <div className="stat__sub">{society.isMemberFunded ? "No s.40 residency requirement." : "At least one BC resident required."}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Consent evidence</div>
          <div className="stat__value" style={{ color: missingConsent.length ? "var(--warn)" : undefined }}>{active.length - missingConsent.length}/{active.length}</div>
          <div className="stat__sub">Written consent or meeting record.</div>
        </div>
        <div className="stat">
          <div className="stat__label">Change of directors</div>
          <div className="stat__value">30d</div>
          <div className="stat__sub">File within 30 days via Societies Online.</div>
        </div>
      </div>

      {directorMode === "register" && (active.length < 3 || (bcResidents < 1 && !society.isMemberFunded) || missingConsent.length > 0) && (
        <div className="col" style={{ marginBottom: 16, gap: 6 }}>
          {active.length < 3 && !society.isMemberFunded && <Flag level="err">Fewer than 3 active directors — regular societies must have at least 3.</Flag>}
          {bcResidents < 1 && !society.isMemberFunded && <Flag level="err">No BC-resident director. At least one is required for non-member-funded societies.</Flag>}
          {missingConsent.length > 0 && <Flag level="warn">{missingConsent.length} director(s) without consent evidence on file.</Flag>}
        </div>
      )}

      {directorMode === "register" ? (
        showMetadataWarning ? (
          <RecordTableMetadataEmpty societyId={society?._id} objectLabel="director" />
        ) : tableData.objectMetadata ? (
          <RecordTableScope
            tableId="directors"
            objectMetadata={tableData.objectMetadata}
            hydratedView={tableData.hydratedView}
            records={records}
            onRecordClick={(_, record) => {
              setSelected(record);
              setOpen(true);
            }}
            onUpdate={async ({ recordId, fieldName, value }) => {
              await update({
                id: recordId as Id<"directors">,
                patch: { [fieldName]: value } as any,
              });
            }}
          >
            <RecordTableViewToolbar
              societyId={society._id}
              objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
              icon={<UserCog size={14} />}
              label="Current legal director register"
              views={tableData.views}
              currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
              onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
              onOpenFilter={() => setFilterOpen((x) => !x)}
            />
            <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
            <RecordTableFilterChips />
            <RecordTable selectable loading={tableData.loading || directors === undefined} />
            <RecordTableBulkBar
              actions={[
                {
                  id: "bulk-remove",
                  label: "Remove",
                  icon: <Trash2 size={12} />,
                  tone: "danger",
                  onRun: async (_ids, rows) => {
                    const ok = await confirm({
                      title: `Remove ${rows.length} director${rows.length === 1 ? "" : "s"}?`,
                      message: "They will be removed from the director register.",
                      confirmLabel: "Remove",
                      tone: "danger",
                    });
                    if (!ok) return;
                    for (const r of rows) await remove({ id: r._id });
                    toast.success(`Removed ${rows.length} director${rows.length === 1 ? "" : "s"}`);
                  },
                },
              ]}
            />
          </RecordTableScope>
        ) : (
          <div className="record-table__loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="record-table__loading-row" />
            ))}
          </div>
        )
      ) : (
        <ArchivedRoleEvidenceView
          roleTerms={roleTerms}
          legalDirectorTerms={legalDirectorTerms}
          archivedRoleTerms={archivedRoleTerms}
          unresolvedRoleTerms={unresolvedRoleTerms}
          currentDirectorKeys={currentDirectorKeys}
        />
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
              label="Director consent evidence on file"
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

function ArchivedRoleEvidenceView({
  roleTerms,
  legalDirectorTerms,
  archivedRoleTerms,
  unresolvedRoleTerms,
  currentDirectorKeys,
}: {
  roleTerms: any[];
  legalDirectorTerms: any[];
  archivedRoleTerms: any[];
  unresolvedRoleTerms: any[];
  currentDirectorKeys: Set<string>;
}) {
  const currentOverlap = new Set(
    legalDirectorTerms
      .filter((term: any) => currentDirectorKeys.has(personNameKey(term.personName)))
      .map((term: any) => personNameKey(term.personName)),
  ).size;
  const legalEvidencePeople = new Set(legalDirectorTerms.map((term: any) => personNameKey(term.personName)).filter(Boolean)).size;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Archived role evidence</h2>
            <p className="card__subtitle">
              Historical board, director, masthead, and editorial observations. Use this for comparison; the Register view remains the current legal director register.
            </p>
          </div>
          <Link className="btn-action" to="/app/org-history">
            Open history
          </Link>
        </div>
        <div className="card__body">
          <div className="stat-grid">
            <div className="stat">
              <div className="stat__label">Historical roles</div>
              <div className="stat__value">{roleTerms.length}</div>
              <div className="stat__sub">board, director, masthead, staff</div>
            </div>
            <div className="stat">
              <div className="stat__label">Director/officer evidence</div>
              <div className="stat__value">{legalDirectorTerms.length}</div>
              <div className="stat__sub">{currentOverlap} current · {Math.max(legalEvidencePeople - currentOverlap, 0)} historical-only</div>
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
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <h2 className="card__title">Archived people and roles</h2>
            <p className="card__subtitle">Compared against active directors by normalized name.</p>
          </div>
        </div>
        <div className="card__body">
          {roleTerms.length > 0 ? (
            <table className="table">
              <thead>
                <tr><th>Person</th><th>Position</th><th>Board/group</th><th>Observed</th><th>Register</th><th>Status</th></tr>
              </thead>
              <tbody>
                {roleTerms.map((term: any) => {
                  const inCurrentRegister = currentDirectorKeys.has(personNameKey(term.personName));
                  return (
                    <tr key={term._id}>
                      <td><strong>{term.personName}</strong></td>
                      <td>{term.position}</td>
                      <td className="muted">{term.committeeName ?? "—"}</td>
                      <td className="mono">{formatDate(term.startDate ?? term.endDate)}</td>
                      <td>
                        <Badge tone={inCurrentRegister ? "info" : "neutral"}>
                          {inCurrentRegister ? "Current register" : "Historical only"}
                        </Badge>
                      </td>
                      <td><Badge tone={roleStatusTone(term.status)}>{term.status ?? "Needs Review"}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="muted">No archived role evidence has been imported yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function cleanAliases(value: unknown) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(new Set(items.map((item) => String(item).trim()).filter(Boolean)));
}

function personNameKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roleStatusTone(status?: string) {
  if (status === "Verified") return "success";
  if (status === "NeedsReview") return "warn";
  return "neutral";
}
