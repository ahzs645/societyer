import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote } from "../components/ui";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { DataTable } from "../components/DataTable";
import { HandHeart, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { Select } from "../components/Select";

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

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const committeeById = new Map<string, any>(
    (committees ?? []).map((committee) => [String(committee._id), committee]),
  );
  const volunteerById = new Map<string, any>(
    (volunteers ?? []).map((volunteer) => [String(volunteer._id), volunteer]),
  );

  const screeningRows = useMemo(
    () =>
      (screenings ?? []).map((screening) => ({
        ...screening,
        volunteerName: volunteerById.get(String(screening.volunteerId))
          ? `${volunteerById.get(String(screening.volunteerId))?.firstName} ${volunteerById.get(String(screening.volunteerId))?.lastName}`
          : "Unknown volunteer",
      })),
    [screenings, volunteerById],
  );

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

      <DataTable
        label="Applications"
        icon={<UserPlus size={14} />}
        data={(applications ?? []) as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search applications…"
        defaultSort={{ columnId: "submittedAtISO", dir: "desc" }}
        columns={[
          {
            id: "name",
            header: "Applicant",
            sortable: true,
            accessor: (row) => `${row.lastName}, ${row.firstName}`,
            render: (row) => (
              <div>
                <strong>{row.firstName} {row.lastName}</strong>
                <div className="muted mono" style={{ fontSize: 11 }}>{row.email}</div>
              </div>
            ),
          },
          { id: "roleWanted", header: "Role", accessor: (row) => row.roleWanted ?? "", render: (row) => <span>{row.roleWanted ?? "—"}</span> },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (row) => row.status,
            render: (row) => <Badge tone={row.status === "Converted" ? "success" : row.status === "Declined" ? "danger" : "warn"}>{row.status}</Badge>,
          },
          { id: "source", header: "Source", sortable: true, accessor: (row) => row.source, render: (row) => <span className="cell-tag">{row.source}</span> },
          { id: "submittedAtISO", header: "Submitted", sortable: true, accessor: (row) => row.submittedAtISO, render: (row) => <span className="mono">{formatDate(row.submittedAtISO)}</span> },
        ]}
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

      <div className="spacer-6" />

      <DataTable
        label="Volunteer roster"
        icon={<HandHeart size={14} />}
        data={(volunteers ?? []) as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search volunteers…"
        defaultSort={{ columnId: "lastName", dir: "asc" }}
        columns={[
          {
            id: "name",
            header: "Volunteer",
            sortable: true,
            accessor: (row) => `${row.lastName}, ${row.firstName}`,
            render: (row) => (
              <div>
                <strong>{row.firstName} {row.lastName}</strong>
                <div className="muted mono" style={{ fontSize: 11 }}>{row.email ?? "No email on file"}</div>
              </div>
            ),
          },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (row) => row.status,
            render: (row) => <Badge tone={row.status === "Active" ? "success" : row.status === "Applied" ? "warn" : "info"}>{row.status}</Badge>,
          },
          {
            id: "committeeId",
            header: "Committee",
            sortable: true,
            accessor: (row) => committeeById.get(String(row.committeeId))?.name ?? "",
            render: (row) => <span>{committeeById.get(String(row.committeeId))?.name ?? "—"}</span>,
          },
          {
            id: "trainingStatus",
            header: "Training",
            sortable: true,
            accessor: (row) => row.trainingStatus ?? "",
            render: (row) => <Badge tone={row.trainingStatus === "Complete" ? "success" : "warn"}>{row.trainingStatus ?? "Pending"}</Badge>,
          },
          {
            id: "screeningRequired",
            header: "Screening",
            sortable: true,
            accessor: (row) => (row.screeningRequired ? 1 : 0),
            render: (row) => <Badge tone={row.screeningRequired ? "warn" : "info"}>{row.screeningRequired ? "Required" : "Not required"}</Badge>,
          },
          {
            id: "renewalDueAtISO",
            header: "Renewal due",
            sortable: true,
            accessor: (row) => row.renewalDueAtISO ?? "",
            render: (row) => <span className="mono">{row.renewalDueAtISO ? formatDate(row.renewalDueAtISO) : "—"}</span>,
          },
        ]}
        renderRowActions={(row) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setVolunteerDraft({ ...row, id: row._id })}>
              Edit
            </button>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Delete volunteer ${row.firstName} ${row.lastName}`}
              onClick={async () => {
                await removeVolunteer({ id: row._id, actingUserId });
                toast.success("Volunteer removed");
              }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      />

      <div className="spacer-6" />

      <DataTable
        label="Screening checks"
        icon={<ShieldCheck size={14} />}
        data={screeningRows as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search checks…"
        defaultSort={{ columnId: "expiresAtISO", dir: "asc" }}
        columns={[
          { id: "volunteerName", header: "Volunteer", sortable: true, accessor: (row) => row.volunteerName, render: (row) => <strong>{row.volunteerName}</strong> },
          { id: "kind", header: "Check", sortable: true, accessor: (row) => row.kind, render: (row) => <span className="cell-tag">{row.kind}</span> },
          {
            id: "provider",
            header: "Provider",
            sortable: true,
            accessor: (row) => row.provider ?? "",
            render: (row) => <span className="muted">{row.provider ?? "Manual"}</span>,
          },
          {
            id: "status",
            header: "Status",
            sortable: true,
            accessor: (row) => row.status,
            render: (row) => <Badge tone={row.status === "clear" ? "success" : row.status === "expired" || row.status === "failed" ? "danger" : "warn"}>{row.status}</Badge>,
          },
          { id: "requestedAtISO", header: "Requested", sortable: true, accessor: (row) => row.requestedAtISO ?? "", render: (row) => <span className="mono">{row.requestedAtISO ? formatDate(row.requestedAtISO) : "—"}</span> },
          { id: "expiresAtISO", header: "Expires", sortable: true, accessor: (row) => row.expiresAtISO ?? "", render: (row) => <span className="mono">{row.expiresAtISO ? formatDate(row.expiresAtISO) : "—"}</span> },
        ]}
        renderRowActions={(row) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setScreeningDraft({ ...row, id: row._id })}>
              Edit
            </button>
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Delete screening check for ${row.volunteerName}`}
              onClick={async () => {
                await removeScreening({ id: row._id, actingUserId });
                toast.success("Screening removed");
              }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      />

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
              <Select value={volunteerDraft.memberId ?? ""} onChange={value => setVolunteerDraft({
  ...volunteerDraft,
  memberId: value
})} options={[{
  value: "",
  label: "None"
}, ...(members ?? []).map(member => ({
  value: member._id,
  label: [member.firstName, member.lastName].join(" ")
}))]} className="input" />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="First name"><input className="input" value={volunteerDraft.firstName} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, firstName: e.target.value })} /></Field>
              <Field label="Last name"><input className="input" value={volunteerDraft.lastName} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, lastName: e.target.value })} /></Field>
            </div>
            <Field label="Email"><input className="input" value={volunteerDraft.email ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={volunteerDraft.phone ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, phone: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <Select value={volunteerDraft.status} onChange={value => setVolunteerDraft({
  ...volunteerDraft,
  status: value
})} options={[{
  value: "",
  label: "Prospect"
}, {
  value: "",
  label: "Applied"
}, {
  value: "",
  label: "Active"
}, {
  value: "",
  label: "Paused"
}, {
  value: "",
  label: "Inactive"
}, {
  value: "",
  label: "Declined"
}]} className="input" />
              </Field>
              <Field label="Committee">
                <Select value={volunteerDraft.committeeId ?? ""} onChange={value => setVolunteerDraft({
  ...volunteerDraft,
  committeeId: value
})} options={[{
  value: "",
  label: "None"
}, ...(committees ?? []).map(committee => ({
  value: committee._id,
  label: committee.name
}))]} className="input" />
              </Field>
            </div>
            <Field label="Role wanted"><input className="input" value={volunteerDraft.roleWanted ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, roleWanted: e.target.value })} /></Field>
            <Field label="Availability"><input className="input" value={volunteerDraft.availability ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, availability: e.target.value })} /></Field>
            <Field label="Interests (comma-separated)"><input className="input" value={(volunteerDraft.interests ?? []).join(", ")} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, interests: e.target.value.split(",").map((value: string) => value.trim()).filter(Boolean) })} /></Field>
            <label className="checkbox"><input type="checkbox" checked={volunteerDraft.screeningRequired} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, screeningRequired: e.target.checked })} /> Screening required for this role</label>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Training status">
                <Select value={volunteerDraft.trainingStatus ?? "Pending"} onChange={value => setVolunteerDraft({
  ...volunteerDraft,
  trainingStatus: value
})} options={[{
  value: "",
  label: "Pending"
}, {
  value: "",
  label: "InProgress"
}, {
  value: "",
  label: "Complete"
}]} className="input" />
              </Field>
              <Field label="Orientation completed">
                <input className="input" type="date" value={volunteerDraft.orientationCompletedAtISO ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, orientationCompletedAtISO: e.target.value })} />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Applied"><input className="input" type="date" value={volunteerDraft.applicationReceivedAtISO ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, applicationReceivedAtISO: e.target.value })} /></Field>
              <Field label="Renewal due"><input className="input" type="date" value={volunteerDraft.renewalDueAtISO ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, renewalDueAtISO: e.target.value })} /></Field>
            </div>
            <Field label="Notes"><textarea className="textarea" value={volunteerDraft.notes ?? ""} onChange={(e) => setVolunteerDraft({ ...volunteerDraft, notes: e.target.value })} /></Field>
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
              <Select value={screeningDraft.volunteerId ?? ""} onChange={value => setScreeningDraft({
  ...screeningDraft,
  volunteerId: value
})} options={[...(volunteers ?? []).map(volunteer => ({
  value: volunteer._id,
  label: [volunteer.firstName, volunteer.lastName].join(" ")
}))]} className="input" />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Check type">
                <Select value={screeningDraft.kind} onChange={value => setScreeningDraft({
  ...screeningDraft,
  kind: value
})} options={[{
  value: "",
  label: "CriminalRecordCheck"
}, {
  value: "",
  label: "ReferenceCheck"
}, {
  value: "",
  label: "Orientation"
}, {
  value: "",
  label: "PolicyAttestation"
}, {
  value: "",
  label: "Training"
}]} className="input" />
              </Field>
              <Field label="Provider">
                <Select value={screeningDraft.provider ?? "BC_CRRP"} onChange={value => setScreeningDraft({
  ...screeningDraft,
  provider: value
})} options={[{
  value: "",
  label: "BC_CRRP"
}, {
  value: "",
  label: "Manual"
}, {
  value: "",
  label: "Other"
}]} className="input" />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <Select value={screeningDraft.status} onChange={value => setScreeningDraft({
  ...screeningDraft,
  status: value
})} options={[{
  value: "",
  label: "needed"
}, {
  value: "",
  label: "requested"
}, {
  value: "",
  label: "clear"
}, {
  value: "",
  label: "failed"
}, {
  value: "",
  label: "expired"
}, {
  value: "",
  label: "waived"
}]} className="input" />
              </Field>
              <Field label="Portal URL">
                <input className="input" value={screeningDraft.portalUrl ?? ""} onChange={(e) => setScreeningDraft({ ...screeningDraft, portalUrl: e.target.value })} />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Requested"><input className="input" type="date" value={screeningDraft.requestedAtISO ?? ""} onChange={(e) => setScreeningDraft({ ...screeningDraft, requestedAtISO: e.target.value })} /></Field>
              <Field label="Completed"><input className="input" type="date" value={screeningDraft.completedAtISO ?? ""} onChange={(e) => setScreeningDraft({ ...screeningDraft, completedAtISO: e.target.value })} /></Field>
            </div>
            <Field label="Expires"><input className="input" type="date" value={screeningDraft.expiresAtISO ?? ""} onChange={(e) => setScreeningDraft({ ...screeningDraft, expiresAtISO: e.target.value })} /></Field>
            <Field label="Reference number"><input className="input" value={screeningDraft.referenceNumber ?? ""} onChange={(e) => setScreeningDraft({ ...screeningDraft, referenceNumber: e.target.value })} /></Field>
            <Field label="Consent document">
              <Select value={screeningDraft.consentDocumentId ?? ""} onChange={value => setScreeningDraft({
  ...screeningDraft,
  consentDocumentId: value
})} options={[{
  value: "",
  label: "None"
}, ...(documents ?? []).map(document => ({
  value: document._id,
  label: document.title
}))]} className="input" />
            </Field>
            <Field label="Result document">
              <Select value={screeningDraft.resultDocumentId ?? ""} onChange={value => setScreeningDraft({
  ...screeningDraft,
  resultDocumentId: value
})} options={[{
  value: "",
  label: "None"
}, ...(documents ?? []).map(document => ({
  value: document._id,
  label: document.title
}))]} className="input" />
            </Field>
            <Field label="Notes"><textarea className="textarea" value={screeningDraft.notes ?? ""} onChange={(e) => setScreeningDraft({ ...screeningDraft, notes: e.target.value })} /></Field>
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
