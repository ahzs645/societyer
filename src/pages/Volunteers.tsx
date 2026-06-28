import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote } from "../components/ui";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { Select } from "../components/Select";
import { HandHeart, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { DatePicker } from "../components/DatePicker";
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

export function VolunteersPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const volunteers = useQuery(
    api.volunteers.list,
    society ? { societyId: society._id } : "skip",
  );
  const applications = useQuery(
    api.volunteers.applications,
    society ? { societyId: society._id } : "skip",
  );
  const screenings = useQuery(
    api.volunteers.screenings,
    society ? { societyId: society._id } : "skip",
  );
  const summary = useQuery(
    api.volunteers.summary,
    society ? { societyId: society._id } : "skip",
  );
  const members = useQuery(
    api.members.list,
    society ? { societyId: society._id } : "skip",
  );
  const committees = useQuery(
    api.committees.list,
    society ? { societyId: society._id } : "skip",
  );
  const documents = useQuery(
    api.documents.list,
    society ? { societyId: society._id } : "skip",
  );
  const upsertVolunteer = useMutation(api.volunteers.upsertVolunteer);
  const removeVolunteer = useMutation(api.volunteers.removeVolunteer);
  const reviewApplication = useMutation(api.volunteers.reviewApplication);
  const convertApplication = useMutation(api.volunteers.convertApplication);
  const upsertScreening = useMutation(api.volunteers.upsertScreening);
  const removeScreening = useMutation(api.volunteers.removeScreening);
  const toast = useToast();
  const [volunteerDraft, setVolunteerDraft] = useState<any | null>(null);
  const [screeningDraft, setScreeningDraft] = useState<any | null>(null);
  const [applicationsViewId, setApplicationsViewId] = useState<Id<"views"> | undefined>(undefined);
  const [applicationsFilterOpen, setApplicationsFilterOpen] = useState(false);
  const [rosterViewId, setRosterViewId] = useState<Id<"views"> | undefined>(undefined);
  const [rosterFilterOpen, setRosterFilterOpen] = useState(false);
  const [screeningViewId, setScreeningViewId] = useState<Id<"views"> | undefined>(undefined);
  const [screeningFilterOpen, setScreeningFilterOpen] = useState(false);

  const applicationsTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "volunteerApplication", viewId: applicationsViewId });
  const rosterTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "volunteer", viewId: rosterViewId });
  const screeningTable = useObjectRecordTableData({ societyId: society?._id, nameSingular: "volunteerScreening", viewId: screeningViewId });

  const committeeById = useMemo(
    () => new Map<string, any>((committees ?? []).map((committee) => [String(committee._id), committee])),
    [committees],
  );
  const volunteerById = useMemo(
    () => new Map<string, any>((volunteers ?? []).map((volunteer) => [String(volunteer._id), volunteer])),
    [volunteers],
  );

  const applicationRecords = useMemo(
    () => (applications ?? []).map((row: any) => ({ ...row, applicant: `${row.firstName} ${row.lastName}` })),
    [applications],
  );
  const rosterRecords = useMemo(
    () => (volunteers ?? []).map((row: any) => ({
      ...row,
      name: `${row.firstName} ${row.lastName}`,
      committee: committeeById.get(String(row.committeeId))?.name ?? "",
    })),
    [volunteers, committeeById],
  );
  const screeningRows = useMemo(
    () =>
      (screenings ?? []).map((screening: any) => ({
        ...screening,
        volunteerName: volunteerById.get(String(screening.volunteerId))
          ? `${volunteerById.get(String(screening.volunteerId))?.firstName} ${volunteerById.get(String(screening.volunteerId))?.lastName}`
          : "Unknown volunteer",
      })),
    [screenings, volunteerById],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Volunteers & screening"
        icon={<HandHeart size={16} />}
        iconColor="pink"
        subtitle="Public/member intake, volunteer assignments, BC CRRP-ready screening records, and annual readiness tracking."
        actions={
          <>
            <button
              className="btn-action"
              onClick={() =>
                setScreeningDraft({
                  societyId: society._id,
                  volunteerId: volunteers?.[0]?._id ?? "",
                  kind: "CriminalRecordCheck",
                  status: "needed",
                  provider: "BC_CRRP",
                  portalUrl:
                    (import.meta as any).env?.VITE_BC_CRRP_ORG_PORTAL_URL ??
                    "https://justice.gov.bc.ca/eCRC/",
                })
              }
            >
              <ShieldCheck size={12} /> Log check
            </button>
            <button
              className="btn-action btn-action--primary"
              onClick={() =>
                setVolunteerDraft({
                  societyId: society._id,
                  firstName: "",
                  lastName: "",
                  email: "",
                  phone: "",
                  status: "Applied",
                  roleWanted: "",
                  availability: "",
                  interests: [],
                  screeningRequired: true,
                  applicationReceivedAtISO: new Date().toISOString().slice(0, 10),
                  renewalDueAtISO: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
                  trainingStatus: "Pending",
                })
              }
            >
              <Plus size={12} /> New volunteer
            </button>
          </>
        }
      />

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <Stat label="Total volunteers" value={String(summary?.total ?? 0)} />
        <Stat label="Active" value={String(summary?.active ?? 0)} />
        <Stat label="Pending intake" value={String(summary?.pendingApplications ?? 0)} />
        <Stat label="Expiring checks" value={String(summary?.expiringChecks ?? 0)} tone={(summary?.overdueChecks ?? 0) > 0 ? "danger" : undefined} />
      </div>

      {!applicationsTable.loading && !applicationsTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="volunteer application" />
      ) : applicationsTable.objectMetadata ? (
        <RecordTableScope
          tableId="volunteerApplications"
          objectMetadata={applicationsTable.objectMetadata}
          hydratedView={applicationsTable.hydratedView}
          records={applicationRecords}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={applicationsTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<UserPlus size={14} />}
            label="Applications"
            views={applicationsTable.views}
            currentViewId={applicationsViewId ?? applicationsTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setApplicationsViewId(viewId as Id<"views">)}
            onOpenFilter={() => setApplicationsFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={applicationsFilterOpen} onClose={() => setApplicationsFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={applicationsTable.loading || applications === undefined}
            renderCell={({ record, field }) => {
              if (field.name === "applicant") return (
                <div>
                  <strong>{record.firstName} {record.lastName}</strong>
                  <div className="muted mono" style={{ fontSize: 11 }}>{record.email}</div>
                </div>
              );
              if (field.name === "roleWanted") return <span>{record.roleWanted ?? "—"}</span>;
              if (field.name === "status") return <Badge tone={record.status === "Converted" ? "success" : record.status === "Declined" ? "danger" : "warn"}>{record.status}</Badge>;
              if (field.name === "source") return <span className="cell-tag">{record.source}</span>;
              if (field.name === "submittedAtISO") return <span className="mono">{formatDate(record.submittedAtISO)}</span>;
              return undefined;
            }}
            renderRowActions={(row) => (
              <>
                {row.status === "Submitted" && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={async () => {
                      await reviewApplication({ id: row._id, status: "Reviewing", actingUserId });
                      toast.success("Application moved to review");
                    }}
                  >
                    Review
                  </button>
                )}
                {!["Converted", "Declined"].includes(row.status) && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={async () => {
                      await convertApplication({
                        id: row._id,
                        committeeId: undefined,
                        screeningRequired: true,
                        actingUserId,
                      });
                      toast.success("Application converted into volunteer record");
                    }}
                  >
                    Convert
                  </button>
                )}
                {row.status !== "Declined" && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={async () => {
                      await reviewApplication({ id: row._id, status: "Declined", actingUserId });
                      toast.success("Application declined");
                    }}
                  >
                    Decline
                  </button>
                )}
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

      <div className="spacer-6" />

      {!rosterTable.loading && !rosterTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="volunteer" />
      ) : rosterTable.objectMetadata ? (
        <RecordTableScope
          tableId="volunteers"
          objectMetadata={rosterTable.objectMetadata}
          hydratedView={rosterTable.hydratedView}
          records={rosterRecords}
          onRecordClick={(_recordId, record) => setVolunteerDraft({ ...record, id: record._id })}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={rosterTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<HandHeart size={14} />}
            label="Volunteer roster"
            views={rosterTable.views}
            currentViewId={rosterViewId ?? rosterTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setRosterViewId(viewId as Id<"views">)}
            onOpenFilter={() => setRosterFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={rosterFilterOpen} onClose={() => setRosterFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={rosterTable.loading || volunteers === undefined}
            renderCell={({ record, field }) => {
              if (field.name === "name") return (
                <div>
                  <strong>{record.firstName} {record.lastName}</strong>
                  <div className="muted mono" style={{ fontSize: 11 }}>{record.email ?? "No email on file"}</div>
                </div>
              );
              if (field.name === "status") return <Badge tone={record.status === "Active" ? "success" : record.status === "Applied" ? "warn" : "info"}>{record.status}</Badge>;
              if (field.name === "committee") return <span>{record.committee || "—"}</span>;
              if (field.name === "trainingStatus") return <Badge tone={record.trainingStatus === "Complete" ? "success" : "warn"}>{record.trainingStatus ?? "Pending"}</Badge>;
              if (field.name === "screeningRequired") return <Badge tone={record.screeningRequired ? "warn" : "info"}>{record.screeningRequired ? "Required" : "Not required"}</Badge>;
              if (field.name === "renewalDueAtISO") return <span className="mono">{record.renewalDueAtISO ? formatDate(record.renewalDueAtISO) : "—"}</span>;
              return undefined;
            }}
            renderRowActions={(row) => (
              <>
                <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setVolunteerDraft({ ...row, id: row._id }); }}>
                  Edit
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Delete volunteer ${row.firstName} ${row.lastName}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await removeVolunteer({ id: row._id, actingUserId });
                    toast.success("Volunteer removed");
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

      <div className="spacer-6" />

      {!screeningTable.loading && !screeningTable.objectMetadata ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="screening check" />
      ) : screeningTable.objectMetadata ? (
        <RecordTableScope
          tableId="volunteerScreenings"
          objectMetadata={screeningTable.objectMetadata}
          hydratedView={screeningTable.hydratedView}
          records={screeningRows}
          onRecordClick={(_recordId, record) => setScreeningDraft({ ...record, id: record._id })}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={screeningTable.objectMetadata._id as Id<"objectMetadata">}
            icon={<ShieldCheck size={14} />}
            label="Screening checks"
            views={screeningTable.views}
            currentViewId={screeningViewId ?? screeningTable.views[0]?._id ?? null}
            onChangeView={(viewId) => setScreeningViewId(viewId as Id<"views">)}
            onOpenFilter={() => setScreeningFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={screeningFilterOpen} onClose={() => setScreeningFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={screeningTable.loading || screenings === undefined}
            renderCell={({ record, field }) => {
              if (field.name === "volunteerName") return <strong>{record.volunteerName}</strong>;
              if (field.name === "kind") return <span className="cell-tag">{record.kind}</span>;
              if (field.name === "provider") return <span className="muted">{record.provider ?? "Manual"}</span>;
              if (field.name === "status") return <Badge tone={record.status === "clear" ? "success" : record.status === "expired" || record.status === "failed" ? "danger" : "warn"}>{record.status}</Badge>;
              if (field.name === "requestedAtISO") return <span className="mono">{record.requestedAtISO ? formatDate(record.requestedAtISO) : "—"}</span>;
              if (field.name === "expiresAtISO") return <span className="mono">{record.expiresAtISO ? formatDate(record.expiresAtISO) : "—"}</span>;
              return undefined;
            }}
            renderRowActions={(row) => (
              <>
                <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setScreeningDraft({ ...row, id: row._id }); }}>
                  Edit
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Delete screening check for ${row.volunteerName}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await removeScreening({ id: row._id, actingUserId });
                    toast.success("Screening removed");
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

      <Drawer
        open={!!volunteerDraft}
        onClose={() => setVolunteerDraft(null)}
        title={volunteerDraft?.id ? "Edit volunteer" : "New volunteer"}
        footer={
          <>
            <button className="btn" onClick={() => setVolunteerDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsertVolunteer({
                  ...volunteerDraft,
                  societyId: society._id,
                  email: volunteerDraft.email || undefined,
                  phone: volunteerDraft.phone || undefined,
                  roleWanted: volunteerDraft.roleWanted || undefined,
                  availability: volunteerDraft.availability || undefined,
                  applicationReceivedAtISO: volunteerDraft.applicationReceivedAtISO || undefined,
                  approvedAtISO: volunteerDraft.approvedAtISO || undefined,
                  orientationCompletedAtISO: volunteerDraft.orientationCompletedAtISO || undefined,
                  trainingStatus: volunteerDraft.trainingStatus || undefined,
                  renewalDueAtISO: volunteerDraft.renewalDueAtISO || undefined,
                  memberId: volunteerDraft.memberId || undefined,
                  committeeId: volunteerDraft.committeeId || undefined,
                  publicApplicationId: volunteerDraft.publicApplicationId || undefined,
                  intakeSource: volunteerDraft.intakeSource || undefined,
                  actingUserId,
                });
                toast.success("Volunteer saved");
                setVolunteerDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {volunteerDraft && (
          <div>
            <Field label="Linked member">
              <Select
                value={volunteerDraft.memberId ?? ""}
                onChange={(value) => setVolunteerDraft({ ...volunteerDraft, memberId: value })}
                options={[
                  { value: "", label: "None" },
                  ...(members ?? []).map((member) => ({ value: member._id, label: `${member.firstName} ${member.lastName}` })),
                ]}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="First name"><input className="input" value={volunteerDraft.firstName} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, firstName: e.target.value })} /></Field>
              <Field label="Last name"><input className="input" value={volunteerDraft.lastName} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, lastName: e.target.value })} /></Field>
            </div>
            <Field label="Email"><input className="input" value={volunteerDraft.email ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={volunteerDraft.phone ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, phone: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <Select
                  value={volunteerDraft.status}
                  onChange={(value) => setVolunteerDraft({ ...volunteerDraft, status: value })}
                  options={[
                    { value: "Prospect", label: "Prospect" },
                    { value: "Applied", label: "Applied" },
                    { value: "Active", label: "Active" },
                    { value: "Paused", label: "Paused" },
                    { value: "Inactive", label: "Inactive" },
                    { value: "Declined", label: "Declined" },
                  ]}
                />
              </Field>
              <Field label="Committee">
                <Select
                  value={volunteerDraft.committeeId ?? ""}
                  onChange={(value) => setVolunteerDraft({ ...volunteerDraft, committeeId: value })}
                  options={[
                    { value: "", label: "None" },
                    ...(committees ?? []).map((committee) => ({ value: committee._id, label: committee.name })),
                  ]}
                />
              </Field>
            </div>
            <Field label="Role wanted"><input className="input" value={volunteerDraft.roleWanted ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, roleWanted: e.target.value })} /></Field>
            <Field label="Availability"><input className="input" value={volunteerDraft.availability ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, availability: e.target.value })} /></Field>
            <Field label="Interests (comma-separated)"><input className="input" value={(volunteerDraft.interests ?? []).join(", ")} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, interests: e.target.value.split(",").map((value: string) => value.trim()).filter(Boolean) })} /></Field>
            <label className="checkbox"><input type="checkbox" checked={volunteerDraft.screeningRequired} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, screeningRequired: e.target.checked })} /> Screening required for this role</label>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Training status">
                <Select
                  value={volunteerDraft.trainingStatus ?? "Pending"}
                  onChange={(value) => setVolunteerDraft({ ...volunteerDraft, trainingStatus: value })}
                  options={[
                    { value: "Pending", label: "Pending" },
                    { value: "InProgress", label: "InProgress" },
                    { value: "Complete", label: "Complete" },
                  ]}
                />
              </Field>
              <Field label="Orientation completed">
                <DatePicker value={volunteerDraft.orientationCompletedAtISO ?? ""} onChange={(value) => setVolunteerDraft({ ...volunteerDraft, orientationCompletedAtISO: value })} />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Applied"><DatePicker value={volunteerDraft.applicationReceivedAtISO ?? ""} onChange={(value) => setVolunteerDraft({ ...volunteerDraft, applicationReceivedAtISO: value })} /></Field>
              <Field label="Renewal due"><DatePicker value={volunteerDraft.renewalDueAtISO ?? ""} onChange={(value) => setVolunteerDraft({ ...volunteerDraft, renewalDueAtISO: value })} /></Field>
            </div>
            <Field label="Notes"><MarkdownEditor rows={4} value={volunteerDraft.notes ?? ""} onChange={(markdown) => setVolunteerDraft({ ...volunteerDraft, notes: markdown })} /></Field>
            {volunteerDraft._id && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
                <CustomFieldsPanel
                  societyId={society._id}
                  entityType="volunteers"
                  entityId={volunteerDraft._id}
                />
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!screeningDraft}
        onClose={() => setScreeningDraft(null)}
        title={screeningDraft?.id ? "Edit screening" : "New screening"}
        footer={
          <>
            <button className="btn" onClick={() => setScreeningDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsertScreening({
                  ...screeningDraft,
                  societyId: society._id,
                  volunteerId: screeningDraft.volunteerId,
                  provider: screeningDraft.provider || undefined,
                  portalUrl: screeningDraft.portalUrl || undefined,
                  requestedAtISO: screeningDraft.requestedAtISO || undefined,
                  completedAtISO: screeningDraft.completedAtISO || undefined,
                  expiresAtISO: screeningDraft.expiresAtISO || undefined,
                  referenceNumber: screeningDraft.referenceNumber || undefined,
                  consentDocumentId: screeningDraft.consentDocumentId || undefined,
                  resultDocumentId: screeningDraft.resultDocumentId || undefined,
                  verifiedByUserId: actingUserId,
                  notes: screeningDraft.notes || undefined,
                  actingUserId,
                });
                toast.success("Screening saved");
                setScreeningDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {screeningDraft && (
          <div>
            <InspectorNote title="BC CRRP workflow">
              Use provider <strong>BC_CRRP</strong> when the check is going through the BC Criminal Records Review Program, then attach the consent and result documents once complete.
            </InspectorNote>
            <Field label="Volunteer">
              <Select
                value={screeningDraft.volunteerId ?? ""}
                onChange={(value) => setScreeningDraft({ ...screeningDraft, volunteerId: value })}
                options={(volunteers ?? []).map((volunteer) => ({ value: volunteer._id, label: `${volunteer.firstName} ${volunteer.lastName}` }))}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Check type">
                <Select
                  value={screeningDraft.kind}
                  onChange={(value) => setScreeningDraft({ ...screeningDraft, kind: value })}
                  options={[
                    { value: "CriminalRecordCheck", label: "CriminalRecordCheck" },
                    { value: "ReferenceCheck", label: "ReferenceCheck" },
                    { value: "Orientation", label: "Orientation" },
                    { value: "PolicyAttestation", label: "PolicyAttestation" },
                    { value: "Training", label: "Training" },
                  ]}
                />
              </Field>
              <Field label="Provider">
                <Select
                  value={screeningDraft.provider ?? "BC_CRRP"}
                  onChange={(value) => setScreeningDraft({ ...screeningDraft, provider: value })}
                  options={[
                    { value: "BC_CRRP", label: "BC_CRRP" },
                    { value: "Manual", label: "Manual" },
                    { value: "Other", label: "Other" },
                  ]}
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <Select
                  value={screeningDraft.status}
                  onChange={(value) => setScreeningDraft({ ...screeningDraft, status: value })}
                  options={[
                    { value: "needed", label: "needed" },
                    { value: "requested", label: "requested" },
                    { value: "clear", label: "clear" },
                    { value: "failed", label: "failed" },
                    { value: "expired", label: "expired" },
                    { value: "waived", label: "waived" },
                  ]}
                />
              </Field>
              <Field label="Portal URL">
                <input className="input" value={screeningDraft.portalUrl ?? ""} onChange={(e) => setScreeningDraft({ ...screeningDraft, portalUrl: e.target.value })} />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Requested"><DatePicker value={screeningDraft.requestedAtISO ?? ""} onChange={(value) => setScreeningDraft({ ...screeningDraft, requestedAtISO: value })} /></Field>
              <Field label="Completed"><DatePicker value={screeningDraft.completedAtISO ?? ""} onChange={(value) => setScreeningDraft({ ...screeningDraft, completedAtISO: value })} /></Field>
            </div>
            <Field label="Expires"><DatePicker value={screeningDraft.expiresAtISO ?? ""} onChange={(value) => setScreeningDraft({ ...screeningDraft, expiresAtISO: value })} /></Field>
            <Field label="Reference number"><input className="input" value={screeningDraft.referenceNumber ?? ""} onChange={(e) => setScreeningDraft({ ...screeningDraft, referenceNumber: e.target.value })} /></Field>
            <Field label="Consent document">
              <Select
                value={screeningDraft.consentDocumentId ?? ""}
                onChange={(value) => setScreeningDraft({ ...screeningDraft, consentDocumentId: value })}
                options={[
                  { value: "", label: "None" },
                  ...(documents ?? []).map((document) => ({ value: document._id, label: document.title })),
                ]}
              />
            </Field>
            <Field label="Result document">
              <Select
                value={screeningDraft.resultDocumentId ?? ""}
                onChange={(value) => setScreeningDraft({ ...screeningDraft, resultDocumentId: value })}
                options={[
                  { value: "", label: "None" },
                  ...(documents ?? []).map((document) => ({ value: document._id, label: document.title })),
                ]}
              />
            </Field>
            <Field label="Notes"><MarkdownEditor rows={4} value={screeningDraft.notes ?? ""} onChange={(markdown) => setScreeningDraft({ ...screeningDraft, notes: markdown })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={tone ? { color: "var(--danger)" } : undefined}>
        {value}
      </div>
    </div>
  );
}
