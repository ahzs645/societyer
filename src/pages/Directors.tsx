import { requiredResidentCanadianDirectors } from "../../shared/legalGovernanceProfiles";
import { calendarDateKey } from "../lib/calendarDates";
import { BoardRosterCard } from "../features/people/BoardRosterCard";
import {PersonRecordLinks} from "../components/PersonRecordLinks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field, Flag, InspectorNote } from "../components/ui";
import { SourceProvenanceButton } from "../components/SourceProvenanceButton";
import { directorProblems, directorTermLapsed, eligibilityScopeFor, roleHolderEligibility, sharedOfficeWarnings } from "../../shared/registerValidation";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Archive, ChevronRight, Plus, Trash2, UserCog } from "lucide-react";
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
} from "@/platform/record-engine";
import type { Id } from "../../convex/_generated/dataModel";
import { directorComplianceProfile } from "../../shared/directorCompliance";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { todayDateOnly } from "../../shared/dateOnly";
import { StatTile } from "../components/StatTile";

const CURRENT_DIRECTORS_VIEW = "Current directors";

export function DirectorsPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canManage = loaded && can("directors:write");
  const directorProfile = directorComplianceProfile(society);
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
  // ?intent=consent (dashboard "Update consent") opens the first active
  // director without consent on file instead of the generic list (G-24).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("intent") !== "consent" || directors === undefined) return;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    const missing = (directors ?? []).filter((director: any) => director.status === "Active" && !director.consentOnFile);
    if (!missing.length) {
      toast.info("Every active director has consent on file");
      return;
    }
    setSelected(missing[0]);
    setOpen(true);
    toast.info(
      `${missing.length} active director${missing.length === 1 ? "" : "s"} without consent on file`,
      missing.map((director: any) => `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim()).join(", "),
    );
  }, [directors, params, setParams, toast]);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "director",
    viewId: currentViewId,
  });
  // The register opens on "Current directors" (former directors filtered
  // out); choosing another view — or clearing the filter — sticks.
  const defaultViewApplied = useRef(false);
  const currentDirectorsView = tableData.views.find((view) => view.name === CURRENT_DIRECTORS_VIEW);
  useEffect(() => {
    if (defaultViewApplied.current || currentViewId || !currentDirectorsView) return;
    defaultViewApplied.current = true;
    setCurrentViewId(currentDirectorsView._id as Id<"views">);
  }, [currentDirectorsView, currentViewId]);
  // Workspaces seeded before the view existed get it once; the seed mutation
  // is idempotent and adds missing views by name.
  const ensureMetadata = useMutation(api.seedRecordTableMetadata.ensureForSociety);
  const metadataHealRef = useRef<string | null>(null);
  useEffect(() => {
    if (!society?._id || !tableData.objectMetadata || !loaded || !can("settings:write")) return;
    if (currentDirectorsView || metadataHealRef.current === String(society._id)) return;
    metadataHealRef.current = String(society._id);
    void ensureMetadata({ societyId: society._id }).catch(() => undefined);
  }, [society?._id, tableData.objectMetadata, currentDirectorsView, loaded, can, ensureMetadata]);

  const active = (directors ?? []).filter((d: any) => d.status === "Active");
  const bcResidents = active.filter((d: any) => d.isBCResident).length;
  const missingConsent = active.filter((d: any) => !d.consentOnFile);
  const canadianResidents = active.filter((d: any) => d.residentCanadianStatus === "yes").length;
  const canadianRequired = requiredResidentCanadianDirectors(active.length);
  const canadianUnknown = active.filter((d: any) => !d.residentCanadianStatus || d.residentCanadianStatus === "unknown").length;
  const minimumMissing = directorProfile.minimumActiveDirectors != null && active.length < directorProfile.minimumActiveDirectors;
  const residencyMissing = directorProfile.requiresBcResidentDirector && bcResidents < 1;
  const canadianMissing = directorProfile.showCanadianResidentField && canadianResidents < canadianRequired;
  // While the directors query is still resolving, every count is 0 and the
  // compliance flags would flash red for a frame before real data arrives.
  // Skip the warning UI until we know the actual numbers.
  const directorsLoaded = directors !== undefined;
  // The BC-resident column is the Societies Act s.40 residency check; hide it
  // where the director rules do not track residency (e.g. corporations).
  const showBcResidentField = directorProfile.showBcResidentField;
  const directorsView = useMemo(() => {
    const view = tableData.hydratedView;
    if (!view || showBcResidentField) return view;
    return { ...view, columns: view.columns.map((column) => column.field?.name === "isBCResident" ? { ...column, isVisible: false } : column) };
  }, [tableData.hydratedView, showBcResidentField]);
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

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setSelected({
      firstName: "", lastName: "", email: "",
      position: "Director", isBCResident: false, residentCanadianStatus: "unknown",
      termStart: todayDateOnly(),
      consentOnFile: false, status: "Active", aliases: [],
    });
    setOpen(true);
  };

  const selectedProblems = selected ? directorProblems(selected) : [];
  const deleteSelected = async () => {
    if (!selected?._id || !canManage) return;
    const name = `${selected.firstName ?? ""} ${selected.lastName ?? ""}`.trim() || "this unnamed director";
    const ok = await confirm({
      title: `Delete ${name}?`,
      message: `${name} will be removed from the director register and from active-director and residency counts. To record that a real director left office, use Resign instead so the term history is kept.`,
      confirmLabel: "Delete director",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await remove({ id: selected._id });
      setOpen(false);
      toast.success("Director deleted");
    } catch (error: any) { toast.error(error.message); }
  };

  const save = async () => {
    if (!selected || !canManage) return;
    if (selectedProblems.length) {
      toast.error("Director not saved", selectedProblems[0]);
      return;
    }
    try {
    if (selected._id) {
      const { _id, _creationTime, societyId, directoryPersonId, entityId, ...patch } = selected;
      patch.aliases = cleanAliases(patch.aliases);
      await update({ id: _id, patch });
    } else {
      await create({ societyId: society._id, ...selected, aliases: cleanAliases(selected.aliases) });
    }
    setOpen(false);
    } catch(error:any){toast.error(error.message);}
  };

  const records = (directors ?? []) as any[];
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title="Directors"
        icon={<UserCog size={16} />}
        iconColor="blue"
        subtitle="The legal director register."
        info={
          <>
            <p>{directorProfile.subtitle}</p>
            <p>
              Officers and past terms live in <Link to="/app/role-holders">Role holders</Link>.
            </p>
          </>
        }
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canManage}>
            <Plus size={12} /> New director
          </button>
        }
      />

      <BoardRosterCard societyId={society._id} activeDirectorCount={active.length} />
      <div className="stat-grid">
        <StatTile
          label="Active directors"
          value={directorsLoaded ? active.length : "—"}
          tone={directorsLoaded && directorProfile.minimumActiveDirectors != null && active.length < directorProfile.minimumActiveDirectors ? "danger" : undefined}
          sub={directorProfile.activeDirectorsSubtext}
        />
        <StatTile
          label={directorProfile.residencyMetricLabel}
          value={directorsLoaded ? (directorProfile.showCanadianResidentField ? `${canadianResidents}/${canadianRequired}` : directorProfile.showBcResidentField ? bcResidents : directorProfile.minimumActiveDirectors === undefined ? "Review" : "Not required") : "—"}
          tone={directorsLoaded && directorProfile.requiresBcResidentDirector && bcResidents < 1 ? "danger" : undefined}
          sub={directorProfile.residencyMetricSubtext}
        />
        <StatTile
          label="Consent evidence"
          value={directorsLoaded ? `${active.length - missingConsent.length}/${active.length}` : "—"}
          tone={directorsLoaded && missingConsent.length ? "warn" : undefined}
          sub={directorProfile.consentExplanation}
        />
        <StatTile
          label="Change of directors"
          value={directorProfile.directorChangeMetric}
          sub={directorProfile.directorChangeSubtext}
        />
      </div>

      {directorsLoaded && (minimumMissing || residencyMissing || canadianMissing || missingConsent.length > 0) && (
        <div className="col" style={{ marginBottom: 16, gap: 6 }}>
          {minimumMissing && <Flag level="err" citationId={directorProfile.citationIds[0]}>Fewer than {directorProfile.minimumActiveDirectors} active legal directors are recorded.</Flag>}
          {residencyMissing && <Flag level="err" citationId="BC-SOC-DIRECTORS-BC-RESIDENT">Record at least one director ordinarily resident in BC.</Flag>}
          {canadianMissing && <Flag level={canadianUnknown ? "warn" : "err"} citationId={directorProfile.citationIds[0]}>{canadianResidents} confirmed resident Canadians; at least {canadianRequired} required for this board. {canadianUnknown} assessment(s) outstanding. Check regulated-sector exceptions.</Flag>}
          {missingConsent.length > 0 && <Flag level="warn">{missingConsent.length} director(s) lack linked consent evidence. {directorProfile.consentExplanation}</Flag>}
        </div>
      )}

      {showMetadataWarning ? (
          <RecordTableMetadataEmpty societyId={society?._id} objectLabel="director" />
        ) : tableData.objectMetadata ? (
          <RecordTableScope
            tableId="directors"
            objectMetadata={tableData.objectMetadata}
            hydratedView={directorsView}
            records={records}
            onRecordClick={(_, record) => {
              setSelected(record);
              setOpen(true);
            }}
            onUpdate={canManage ? async ({ recordId, fieldName, value }) => {
              await update({
                id: recordId as Id<"directors">,
                patch: { [fieldName]: value } as any,
              });
            } : undefined}
          >
            <RecordTableViewToolbar
              societyId={society._id}
              objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
              icon={<UserCog size={14} />}
              label="Current legal director register"
              views={tableData.views}
              currentViewId={currentViewId ?? currentDirectorsView?._id ?? tableData.views[0]?._id ?? null}
              onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
              onOpenFilter={() => setFilterOpen((x) => !x)}
            />
            <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
            <RecordTableFilterChips />
            <RecordTable
              selectable={canManage}
              loading={tableData.loading || directors === undefined}
              renderCell={({ field, record }) => field.name === "firstName" ? (
                <button type="button" className="record-table__identifier-button" onClick={() => { setSelected(record); setOpen(true); }}>
                  {record.firstName || record.lastName || "Unnamed director"}
                  {directorTermLapsed(record, calendarDateKey(new Date())) ? (
                    <span className="badge badge--warn" style={{ marginLeft: 6 }} title={`Term ended ${record.termEnd}; record a re-election or resignation.`}>Term ended</span>
                  ) : null}
                </button>
              ) : undefined}
            />
            <RecordTableBulkBar
              actions={canManage ? [
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
              ] : []}
            />
          </RecordTableScope>
        ) : (
          <div className="record-table__loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="record-table__loading-row" />
            ))}
          </div>
      )}

      {roleTerms.length > 0 && (
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
        title={selected?._id ? (canManage ? "Edit director" : "View director") : "Add director"}
        footer={
          <>
            {selected?._id && canManage ? (
              <button className="btn btn--danger" style={{ marginRight: "auto" }} onClick={deleteSelected}>
                <Trash2 size={12} /> Delete
              </button>
            ) : null}
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save} disabled={!canManage || selectedProblems.length > 0}>Save</button>
          </>
        }
      >
        {selected?._id && <div style={{ marginBottom: 8 }}><SourceProvenanceButton table="directors" id={selected._id} /></div>}
        {selected && (
          <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {selectedProblems.length > 0 && (
              <InspectorNote tone="danger" title="Required before saving">
                {selectedProblems.join(" ")}
              </InspectorNote>
            )}
            {(() => {
              // Corporations only: BC company directors must be individuals
              // (BCA s. 124 (1)); single offices held twice are flagged. A
              // society's director register keeps the Societies Act rules.
              const scope = eligibilityScopeFor(society);
              if (scope === "not_corporation") return null;
              const fullName = `${selected.firstName ?? ""} ${selected.lastName ?? ""}`.trim();
              const status = ["Resigned", "Removed"].includes(selected.status) ? "former" : "current";
              const eligibility = roleHolderEligibility({ roleType: "director", status, fullName, startDate: selected.termStart }, scope, calendarDateKey(new Date()));
              const others = (directors ?? []).filter((d: any) => d._id !== selected._id);
              const shared = sharedOfficeWarnings([...others, selected].map((d: any) => ({ id: d._id, fullName: `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim(), status: d.status, position: d.position })))
                .filter((warning) => warning.includes(fullName || "Unnamed"));
              const warnings = [...eligibility.warnings, ...shared];
              return (
                <>
                  {warnings.length > 0 && <InspectorNote tone="warn" title="Check before saving">{warnings.join(" ")}</InspectorNote>}
                  {eligibility.notes.length > 0 && <InspectorNote tone="info" title="Qualifications">{eligibility.notes.join(" ")}</InspectorNote>}
                </>
              );
            })()}
            {directorTermLapsed(selected, calendarDateKey(new Date())) && (
              <InspectorNote tone="warn" title="Term has ended">
                This director's term ended {selected.termEnd} but the record is still Active. Record the re-election (new term end) or the date they left office.
              </InspectorNote>
            )}
            {selected._id&&<PersonRecordLinks societyId={society._id} recordTable="directors" recordId={selected._id} personName={`${selected.firstName} ${selected.lastName}`} observedDate={selected.termStart}/>}
            <InspectorNote tone="warn" title="Director register">
              {/* Timing comes from the governing-Act profile: the Societies Act
                  has no general 15- or 30-day director-change deadline. */}
              Keep this register current. Director-change filing: {directorProfile.directorChangeSubtext}
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
              <Select
                value={selected.memberId ?? ""}
                onChange={(value) => setSelected({ ...selected, memberId: value || undefined })}
                options={[
                  { value: "", label: "No linked member" },
                  ...(members ?? []).map((member: any) => ({
                    value: member._id,
                    label: `${member.firstName} ${member.lastName}${member.email ? ` · ${member.email}` : ""}`,
                  })),
                ]}
              />
            </Field>
            {selected._id&&selected.position!==(directors??[]).find((d:any)=>d._id===selected._id)?.position&&<div className="card__body col" style={{gap:8}}>
              <p>Record this position change with its effective day and reviewed evidence. The previous register values are retained in person history.</p>
              <Field label="Position effective day"><input className="input" type="date" value={selected.positionChangeEvidence?.effectiveDate??''} onChange={e=>setSelected({...selected,positionChangeEvidence:{...selected.positionChangeEvidence,effectiveDate:e.target.value,reviewStatus:'verified'}})}/></Field>
              <Field label="Position change source URL"><input className="input" value={selected.positionChangeEvidence?.sourceUrl??''} onChange={e=>setSelected({...selected,positionChangeEvidence:{...selected.positionChangeEvidence,sourceUrl:e.target.value,reviewStatus:'verified'}})}/></Field>
              <Field label="Position change citation"><input className="input" value={selected.positionChangeEvidence?.sourceReference??''} onChange={e=>setSelected({...selected,positionChangeEvidence:{...selected.positionChangeEvidence,sourceReference:e.target.value,reviewStatus:'verified'}})}/></Field>
            </div>}
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
                  options={["Active", "NeedsReview", "Resigned", "Removed"].map((s) => ({ value: s, label: s === "NeedsReview" ? "Needs review (from a source roster)" : s }))}
                />
              </Field>
            </div>
            {directorProfile.showBcResidentField && (
              <Checkbox
                checked={!!selected.isBCResident}
                onChange={(v) => setSelected({ ...selected, isBCResident: v })}
                label="BC resident"
              />
            )}
            {directorProfile.showCanadianResidentField && <>
              <Field label="Resident Canadian under the CBCA" hint="Apply the statutory definition in s. 2(1). A BC address or citizenship alone does not answer every part of the test.">
                <Select value={selected.residentCanadianStatus ?? "unknown"} onChange={value => setSelected({ ...selected, residentCanadianStatus: value })} options={[{ value: "unknown", label: "Not assessed" }, { value: "yes", label: "Confirmed resident Canadian" }, { value: "no", label: "Not a resident Canadian" }]} />
              </Field>
              <Field label="Residency assessment evidence"><input className="input" value={selected.residentCanadianEvidence ?? ""} onChange={e => setSelected({ ...selected, residentCanadianEvidence: e.target.value })} /></Field>
            </>}
            <Checkbox
              checked={!!selected.consentOnFile}
              onChange={(v) => setSelected({ ...selected, consentOnFile: v })}
              label="Director consent evidence on file"
            />
            <Field label="Notes"><MarkdownEditor readOnly={!canManage} rows={4} value={selected.notes ?? ""} onChange={(markdown) => setSelected({ ...selected, notes: markdown })} /></Field>
            {selected._id && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
                <CustomFieldsPanel
                  societyId={society._id}
                  entityType="directors"
                  entityId={selected._id}
                />
              </div>
            )}
          </fieldset>
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
    <details className="card directors-history">
      <summary className="card__head directors-history__summary">
        <ChevronRight size={14} className="directors-history__chevron" aria-hidden="true" />
        <Archive size={14} aria-hidden="true" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 className="card__title">Role history evidence</h2>
          <p className="card__subtitle">
            {roleTerms.length} historical role{roleTerms.length === 1 ? "" : "s"} · {archivedRoleTerms.length} archived · {unresolvedRoleTerms.length} unresolved
          </p>
        </div>
        <Link className="btn-action" to="/app/org-history" onClick={(event) => event.stopPropagation()}>
          Open history
        </Link>
      </summary>
      <div className="card__body">
        <p className="muted" style={{ margin: "0 0 12px", fontSize: "var(--fs-sm)" }}>
          Board, masthead and editorial observations for comparison only.{" "}
          {currentOverlap} match a current director; {Math.max(legalEvidencePeople - currentOverlap, 0)} appear only historically.
        </p>
        <div className="table-wrap">
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
          ) : null}
        </div>
      </div>
    </details>
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
