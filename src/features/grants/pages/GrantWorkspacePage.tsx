import { usePermissions } from "@/hooks/usePermissions";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { ArrowLeft, BadgeDollarSign, Pencil, Save } from "lucide-react";
import { PageHeader, SeedPrompt } from "../../../pages/_helpers";
import { useCurrentUserId } from "../../../hooks/useCurrentUser";
import { useSociety } from "../../../hooks/useSociety";
import { useToast } from "../../../components/Toast";
import { RecordNotFound } from "../../../components/RecordNotFound";
import { useRecordQuery } from "../../../hooks/useRecordQuery";
import { hasErrors, validateGrantInput, type FieldErrors } from "../../../../shared/recordValidation";
import {
  buildGrantPayload,
  grantToDraft,
} from "../lib/grantDrafts";
import {
  GrantEditorForm,
  GrantReadPanel,
} from "../components/GrantPanels";
import { buildCsjOrientationEmailBody } from "../lib/csjOrientationEmail";
import { LinkedAgreementsCard } from "../../agreements/LinkedAgreementsCard";

export function GrantDetailPage() {
  return <GrantWorkspacePage />;
}

export function GrantEditPage() {
  return <GrantWorkspacePage initialEditing />;
}

function GrantWorkspacePage({ initialEditing = false }: { initialEditing?: boolean }) {
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("grants:write");
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const grant = useRecordQuery<any>(api.grants.get, id ? { id } : "skip");
  const reports = useQuery(api.grants.reports, society ? { societyId: society._id } : "skip");
  const committees = useQuery(api.committees.list, society && loaded && can("committees:read") ? { societyId: society._id } : "skip");
  const users = useQuery(api.users.list, society && loaded && can("users:read") ? { societyId: society._id } : "skip");
  const accounts = useQuery(api.financialHub.accounts, society && loaded && can("financials:read") ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const employees = useQuery(api.employees.list, society && loaded && can("employees:read") ? { societyId: society._id } : "skip");
  const employeeLinks = useQuery(api.grants.employeeLinks, society && grant ? { societyId: society._id, grantId: id } : "skip");
  const secretVaultItems = useQuery(api.secrets.list, society && loaded && can("settings:read") ? { societyId: society._id } : "skip");
  const upsertEmployeeLink = useMutation(api.grants.upsertEmployeeLink);
  const removeEmployeeLink = useMutation(api.grants.removeEmployeeLink);
  const createEmployee = useMutation(api.employees.create);
  const createPendingEmail = useMutation(api.pendingEmails.create);
  const createSecret = useMutation(api.secrets.create);
  const upsertGrant = useMutation(api.grants.upsertGrant);
  const [editing, setEditing] = useState(initialEditing);
  const [grantDraft, setGrantDraft] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!grant) return;
    setGrantDraft((current) => current?.id === grant._id ? current : grantToDraft(grant));
  }, [grant?._id]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (grant === undefined) return <div className="page">Loading…</div>;
  if (!grant || grant.societyId !== society._id) {
    return <RecordNotFound recordLabel="Grant" backTo="/app/grants" backLabel="All grants" icon={<BadgeDollarSign size={16} />} />;
  }

  const committee = (committees ?? []).find((row) => String(row._id) === String(grant.committeeId));
  const owner = (users ?? []).find((row) => String(row._id) === String(grant.boardOwnerUserId));
  const account = (accounts ?? []).find((row) => String(row._id) === String(grant.linkedFinancialAccountId));
  const accountById = new Map<string, any>((accounts ?? []).map((row) => [String(row._id), row]));

  const startEditing = () => {
    setGrantDraft(grantToDraft(grant));
    setEditing(true);
  };

  const cancelEditing = () => {
    setGrantDraft(grantToDraft(grant));
    setEditing(false);
  };

  const saveGrant = async () => {
    if (!canWrite || !grantDraft) return;
    const payload = buildGrantPayload(grantDraft, society._id, actingUserId);
    const validation = validateGrantInput(payload);
    setErrors(validation);
    if (hasErrors(validation)) {
      toast.error("Check the highlighted fields", Object.values(validation)[0]);
      return;
    }
    setSaving(true);
    try {
      await upsertGrant(payload);
      toast.success("Grant saved");
      setEditing(false);
    } catch (error: any) {
      toast.error("Could not save the grant", error?.message ?? "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const sharedReadPanelProps = {
    documents: documents ?? [],
    reports: reports ?? [],
    employees: employees ?? [],
    employeeLinks: employeeLinks ?? [],
    secretVaultItems: secretVaultItems ?? [],
    committee,
    owner,
    account,
    viewMode: "page" as const,
    onLinkEmployee: async (employeeId: any, patch = {}) => {
      await upsertEmployeeLink({
        societyId: society._id,
        grantId: grant._id,
        employeeId,
        patch: { status: "eed_pending", source: "manual", ...patch },
      });
    },
    onUnlinkEmployee: async (linkId: any) => {
      await removeEmployeeLink({ id: linkId });
    },
    onCreateEmployee: async (draft: any) => {
      return createEmployee({
        societyId: society._id,
        firstName: String(draft.firstName ?? ""),
        lastName: String(draft.lastName ?? ""),
        email: draft.email ? String(draft.email) : undefined,
        phone: draft.phone ? String(draft.phone) : undefined,
        birthDate: draft.birthDate ? String(draft.birthDate) : undefined,
        addressLine1: draft.addressLine1 ? String(draft.addressLine1) : undefined,
        addressLine2: draft.addressLine2 ? String(draft.addressLine2) : undefined,
        city: draft.city ? String(draft.city) : undefined,
        province: draft.province ? String(draft.province) : undefined,
        postalCode: draft.postalCode ? String(draft.postalCode) : undefined,
        country: draft.country ? String(draft.country) : undefined,
        sinSecretVaultItemId: draft.sinSecretVaultItemId ? (draft.sinSecretVaultItemId as any) : undefined,
        role: String(draft.role ?? ""),
        startDate: String(draft.startDate ?? ""),
        endDate: draft.endDate ? String(draft.endDate) : undefined,
        employmentType: String(draft.employmentType ?? "FullTime"),
        hourlyWageCents: typeof draft.hourlyWageCents === "number" ? draft.hourlyWageCents : undefined,
        annualSalaryCents: typeof draft.annualSalaryCents === "number" ? draft.annualSalaryCents : undefined,
        worksafeBCNumber: draft.worksafeBCNumber ? String(draft.worksafeBCNumber) : undefined,
        cppExempt: Boolean(draft.cppExempt),
        eiExempt: Boolean(draft.eiExempt),
        notes: draft.notes ? String(draft.notes) : undefined,
      });
    },
    onQueueEmployeeOrientationEmail: async (employee: any, currentGrant: any) => {
      await createPendingEmail({
        societyId: society._id,
        nodeKey: "csj_remote_worker_orientation.queue_orientation_email",
        fromName: "Over the Edge",
        fromEmail: "ote@unbc.ca",
        to: String(employee.email ?? ""),
        subject: "Canada Summer Jobs remote work orientation resources",
        body: buildCsjOrientationEmailBody(employee),
        status: "ready",
        notes: `System workflow: CSJ remote worker orientation. Grant: ${currentGrant.title}. Evidence for GCOS Young Workers/EED attestation.`,
      });
    },
    onCreateSinVaultRecord: async (draft: any) => {
      return createSecret({
        societyId: society._id,
        name: String(draft.name ?? "SIN - funded employee"),
        service: "Employee SIN",
        credentialType: "Social Insurance Number",
        ownerRole: "Employer",
        custodianPersonName: draft.custodianPersonName ? String(draft.custodianPersonName) : undefined,
        custodianEmail: draft.custodianEmail ? String(draft.custodianEmail) : undefined,
        storageMode: draft.secretValue ? "stored_encrypted" : "external_reference",
        externalLocation: draft.externalLocation ? String(draft.externalLocation) : undefined,
        secretValue: draft.secretValue ? String(draft.secretValue) : undefined,
        revealPolicy: "owner_admin_custodian",
        status: "Active",
        sensitivity: "high",
        accessLevel: "restricted",
        sourceExternalIds: [`grant:${String(grant._id)}`],
        notes: draft.notes ? String(draft.notes) : undefined,
      });
    },
  };

  return (
    <div className="page">
      <Link to="/app/grants" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> All grants
      </Link>
      <PageHeader
        title={grant.title}
        icon={<BadgeDollarSign size={16} />}
        iconColor="green"
        subtitle={editing ? "Editing grant details" : `${grant.funder}${grant.program ? ` · ${grant.program}` : ""}`}
        actions={
          editing && canWrite ? (
            <>
              <button className="btn-action" onClick={cancelEditing} disabled={saving}>Cancel</button>
              <button className="btn-action btn-action--primary" onClick={saveGrant} disabled={!canWrite || (saving)}>
                <Save size={12} /> {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-action btn-action--icon grant-workspace__edit"
              onClick={startEditing}
              disabled={!canWrite}
              aria-label="Edit workspace"
              title="Edit workspace"
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
          )
        }
      />

      {editing && canWrite && grantDraft ? (
        <GrantReadPanel
          key="edit"
          {...sharedReadPanelProps}
          grant={grantDraft}
          editable
          editorPanel={
            <GrantEditorForm
              grantDraft={grantDraft}
              setGrantDraft={setGrantDraft}
              errors={errors}
              committees={committees ?? []}
              users={users ?? []}
              accounts={accounts ?? []}
              documents={documents ?? []}
              reports={reports ?? []}
              accountById={accountById}
              layout="page"
            />
          }
        />
      ) : (
        <GrantReadPanel key="read" {...sharedReadPanelProps} grant={grant} />
      )}
      {!editing && <LinkedAgreementsCard table="grants" recordId={grant._id} title="Funding agreements" />}
    </div>
  );
}
