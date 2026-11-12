import { isStaticDemoRuntime } from "../lib/staticRuntime";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId, setStoredUserId } from "../hooks/useCurrentUser";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Avatar, Badge, Drawer, Field, type ToneVariant } from "../components/ui";
import { Select } from "../components/Select";
import { Copy, UserCog, Plus, PlusCircle, Trash2, KeyRound, ShieldCheck, ShieldOff, Pencil } from "lucide-react";
import type { MenuItem, MenuSection } from "../components/Menu";
import { InfoPopover } from "../components/InfoPopover";
import { formatDate } from "../lib/format";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  type RecordTableCardHelpers,
} from "../platform/record-engine/record-table";
import { FIELD_TYPES, type FieldMetadata, type SelectOption } from "../platform/record-engine/types";
import { useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthProvider";
import { WorkspaceMfaActions } from "../auth/WorkspaceMfaActions";
import type { WorkspaceMfaPolicy } from "../../shared/workspaceMfa";
import type { Id } from "../../convex/_generated/dataModel";
import { useConfirm } from "../components/Modal";
import { WorkspaceAccessViewer } from "../components/WorkspaceAccessViewer";
import { organizationKind } from "../../shared/organizationDomain";
import { hasErrors, validateWorkspaceUserInput, type FieldErrors } from "../../shared/recordValidation";
import { AccessRequestsPanel } from "../components/AccessRequestsPanel";
import { membershipStatusLabel } from "../../shared/membershipStatusLabel";

const ROLES = ["Owner", "Admin", "Director", "Member", "Viewer"];
// Share links admit whoever opens them, so they can't grant Owner or Admin.
const LINK_ROLES = ["Director", "Member", "Viewer"];
type InviteForm = { targetUserId?: string; kind: "email" | "link"; email: string; label: string; role: string; expiresInDays: number };
const NEW_INVITE: InviteForm = { kind: "email", email: "", label: "", role: "Member", expiresInDays: 7 };

export function UsersPage() {
  const society = useSociety();
  const [, setInviteParams] = useSearchParams();
  const auth = useAuth();
  const { role: myRole, permissions, can, loaded: permissionsLoaded } = usePermissions();
  const canViewRoster = permissionsLoaded && can("users:read");
  const users = useQuery(
    api.users.list,
    society && canViewRoster ? { societyId: society._id } : "skip",
  );
  const upsert = useMutation(api.users.upsert);
  const securityDisable = useMutation(api.users.securityDisable);
  const [incident, setIncident] = useState<{ id: any; name: string; reason: string } | null>(null);
  const actingUserId = useCurrentUserId() ?? undefined;
  const canManageUsers = permissionsLoaded && can("users:write");
  const canRemoveUsers = permissionsLoaded && myRole === "Owner";
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const assignableRoles = myRole === "Owner" ? ROLES : ROLES.filter((role) => !["Owner", "Admin"].includes(role));
  const [draft, setDraft] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [draftErrors, setDraftErrors] = useState<FieldErrors>({});
  const toast = useToast();

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Users & access"
        icon={<UserCog size={16} />}
        iconColor="blue"
        subtitle={
          auth.mode !== "none"
            ? "Manage workspace memberships, roles, and the access policy for each signed-in user."
            : "Workspace memberships and the access each role grants."
        }
        actions={
          canManageUsers ? (
            <button
              className="btn-action btn-action--primary"
              onClick={() => auth.mode !== "none" ? setInviteParams({ intent: "invite" }) :
                setDraft({
                  email: "",
                  displayName: "",
                  role: "Member",
                  status: "Active",
                })
              }
            >
              <Plus size={12} /> {auth.mode !== "none" ? "Invite user" : "Add user"}
            </button>
          ) : undefined
        }
      />

      {society.accessRecoveryRequired && <div className="card"><div className="card__body">This workspace requires controlled access recovery. A security disable removed its last Active Owner. An authorized operator must establish a new owner; disabled identities keep no access.</div></div>}

      {auth.workspaceMfaAvailable && permissionsLoaded && myRole === "Owner" &&
        <WorkspaceMfaSettings key={society._id} societyId={society._id} />}

      {myRole && (
        <details className="card access-summary">
          <summary className="access-summary__head">
            <ShieldCheck size={14} aria-hidden="true" />
            <span className="access-summary__label">Your access</span>
            <Badge tone={myRole === "Owner" || myRole === "Admin" ? "success" : "info"}>{myRole}</Badge>
            <span className="access-summary__text">
              {capitalize(roleSummary(myRole).replace(/^[A-Za-z]+: /, ""))}
              {!canManageUsers && (canViewRoster ? " You can view users but not change roles." : " Your role can't view the workspace roster.")}
            </span>
            <span className="access-summary__more">{permissions.length} permission{permissions.length === 1 ? "" : "s"}</span>
          </summary>
          <div className="access-summary__body">
            {permissions.map((p) => (
              <code key={p} className="chip chip--sm">{p}</code>
            ))}
          </div>
        </details>
      )}

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Users</h2>
          {users && <Badge>{users.length}</Badge>}
          {auth.mode === "none" && (
            <InfoPopover label="About acting as a user">
              <p>Use "Act as" (or the acting-user picker in the header) to preview the workspace as another role.</p>
            </InfoPopover>
          )}
        </div>
        {!permissionsLoaded && <p role="status" className="muted">Checking workspace access…</p>}
        {permissionsLoaded && !canViewRoster && <p role="status" className="muted">Your role does not permit viewing the workspace roster. Your own access is shown above.</p>}
        {canViewRoster && (
          <UsersRoster
            users={users}
            myRole={myRole}
            hostedSignIn={auth.mode !== "none"}
            canManageUsers={canManageUsers}
            canRemoveUsers={canRemoveUsers}
            assignableRoles={assignableRoles}
            selectedUserId={selectedUserId}
            onViewAccess={setSelectedUserId}
            onInvite={(user) => setInviteParams({ intent: "invite", inviteEmail: user.email, inviteRole: user.role, inviteUserId: user._id })}
            onEdit={setDraft}
            onSecurityDisable={(user) => setIncident({ id: user._id, name: user.displayName, reason: "" })}
          />
        )}
      </div>

      {canManageUsers && (
        <InvitationsPanel societyId={society._id} assignableRoles={assignableRoles} />
      )}

      {auth.mode === "convex" && permissionsLoaded && (myRole === "Owner" || myRole === "Admin") && (
        <AccessRequestsPanel key={society._id} societyId={society._id} assignableRoles={assignableRoles} />
      )}

      {canManageUsers && users && users.length > 0 && (
        <WorkspaceAccessViewer
          users={users}
          selectedUserId={selectedUserId ?? actingUserId ?? users[0]._id}
          onSelectUser={setSelectedUserId}
          moduleSource={society}
          entityKind={organizationKind(society as any)}
        />
      )}

      <Drawer open={!!incident} onClose={() => setIncident(null)} title="Security disable access" footer={<>
        <button className="btn" onClick={() => setIncident(null)}>Cancel</button>
        <button className="btn btn--accent" disabled={!incident?.reason.trim()} onClick={async () => {
          if (!incident) return;
          try { await securityDisable({ id: incident.id, reason: incident.reason }); setIncident(null); toast.success("Access disabled"); }
          catch (error) { toast.error("Could not disable access", error instanceof Error ? error.message : String(error)); }
        }}>Disable immediately</button>
      </>}>
        <p>Disable {incident?.name} for a security incident. Their future sessions, API calls and workflow work lose access immediately. Disabling the last Active Owner places this workspace in controlled recovery.</p>
        <Field label="Incident reason"><textarea className="input" value={incident?.reason ?? ""} maxLength={1000} onChange={(event) => incident && setIncident({ ...incident, reason: event.target.value })} /></Field>
      </Drawer>

      <Drawer
        open={!!draft}
        onClose={() => { setDraft(null); setDraftErrors({}); }}
        title={draft?._id ? "Edit user" : "Add user"}
        footer={
          <>
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={saving}
              onClick={async () => {
                if (saving) return;
                const validation = validateWorkspaceUserInput(draft, users ?? [], draft._id);
                setDraftErrors(validation);
                if (hasErrors(validation)) return;
                setSaving(true);
                try {
                  await upsert({
                    id: draft._id,
                    societyId: society._id,
                    email: String(draft.email ?? "").trim(),
                    displayName: String(draft.displayName ?? "").trim(),
                    role: draft.role,
                    status: draft.status,
                    memberId: draft.memberId,
                    directorId: draft.directorId,
                  });
                  toast.success(draft._id ? "User updated" : "User added", String(draft.displayName ?? "").trim());
                  setDraft(null);
                } catch (error) {
                  console.error("[users.upsert]", error);
                  toast.error("Couldn't save user", error instanceof Error ? error.message : String(error));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {draft && (
          <div>
            <Field label="Display name" required error={draftErrors.displayName}>
              <input
                className="input"
                value={draft.displayName}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              />
            </Field>
            <Field label="Email" required error={draftErrors.email}>
              <input
                className="input"
                type="email"
                autoComplete="off"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <Select
                value={draft.role}
                onChange={(v) => setDraft({ ...draft, role: v })}
                options={assignableRoles.map((r) => ({ value: r, label: r }))}
              />
            </Field>
            <Field label="Status">
              <Select
                value={draft.status}
                onChange={(v) => setDraft({ ...draft, status: v })}
                options={[
                  { value: "Active", label: "Active" },
                  { value: "Invited", label: "Invited" },
                  { value: "Disabled", label: "Disabled" },
                  { value: "Suspended", label: "Suspended" },
                  { value: "Pending", label: "Pending" },
                ]}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

/** A workspace membership as users:list returns it. */
type WorkspaceUser = {
  _id: Id<"users">;
  displayName: string;
  email: string;
  role: string;
  status?: string;
  authSubject?: string;
  authIssuer?: string;
  mergedIntoUserId?: string;
  mergedIntoDisplayName?: string;
  lastLoginAtISO?: string;
};
type RosterRecord = WorkspaceUser & {
  /** The status filter's key ("Merged" for every retired duplicate); `statusLabel` is what the row says. */
  accessStatus: string;
  statusLabel: string;
  _searchText: string;
};

const ROLE_OPTIONS: SelectOption[] = [
  { value: "Owner", label: "Owner", color: "purple" },
  { value: "Admin", label: "Admin", color: "blue" },
  { value: "Director", label: "Director", color: "teal" },
  { value: "Member", label: "Member", color: "green" },
  { value: "Viewer", label: "Viewer", color: "gray" },
];
const USER_STATUS_OPTIONS: SelectOption[] = [
  { value: "Active", label: "Active", color: "green" },
  { value: "Not joined", label: "Not joined", color: "amber" },
  { value: "Invited", label: "Invited", color: "amber" },
  { value: "Pending", label: "Pending", color: "gray" },
  { value: "Disabled", label: "Disabled", color: "gray" },
  { value: "Suspended", label: "Suspended", color: "gray" },
  { value: "Merged", label: "Merged", color: "gray" },
];

const ROSTER_TABLE = staticRecordTable({
  id: "users-roster",
  nameSingular: "workspaceUser",
  namePlural: "workspaceUsers",
  labelSingular: "User",
  labelPlural: "Users",
  labelIdentifierFieldName: "displayName",
  density: "comfortable",
  fields: [
    { name: "displayName", label: "User", fieldType: FIELD_TYPES.TEXT, size: 300, config: { groupable: false } },
    { name: "email", label: "Email", fieldType: FIELD_TYPES.EMAIL, size: 240, isVisible: false, config: { groupable: false } },
    { name: "role", label: "Role", fieldType: FIELD_TYPES.SELECT, size: 170, config: { options: ROLE_OPTIONS } },
    { name: "accessStatus", label: "Status", fieldType: FIELD_TYPES.SELECT, size: 150, config: { options: USER_STATUS_OPTIONS } },
    { name: "lastLoginAtISO", label: "Last login", fieldType: FIELD_TYPES.DATE, size: 140 },
  ],
});

function userStatusTone(statusLabel: string): ToneVariant {
  return statusLabel === "Active" ? "success" : ["Invited", "Not joined"].includes(statusLabel) ? "warn" : "neutral";
}

/** A user's role, changed in place after a confirmation. The last Active Owner's stays fixed. */
function UserRoleSelect({
  user,
  lastOwner,
  disabled,
  assignableRoles,
}: {
  user: WorkspaceUser;
  lastOwner: boolean;
  disabled: boolean;
  assignableRoles: string[];
}) {
  const setRole = useMutation(api.users.setRole);
  const toast = useToast();
  const confirm = useConfirm();
  return (
    <span title={lastOwner ? "Promote another user to Owner before changing or removing this one." : undefined}>
      <Select
        size="sm"
        value={user.role}
        disabled={lastOwner || disabled}
        onChange={async (v) => {
          const ok = await confirm({
            title: "Change user role?",
            message: `${user.displayName} will change from ${user.role} to ${v}. Review whether this affects access to governance, finance, or public publishing workflows.`,
            confirmLabel: "Change role",
            tone: "warn",
          });
          if (!ok) return;
          try {
            await setRole({ id: user._id, role: v });
            toast.success("Role updated");
          } catch (error) {
            toast.error("Couldn't change role", error instanceof Error ? error.message : String(error));
          }
        }}
        aria-label={`Role for ${user.displayName}`}
        options={assignableRoles.map((r) => ({ value: r, label: r }))}
      />
    </span>
  );
}

/** The workspace roster on the shared record table: who, role (changed in place), status, last login. */
function UsersRoster({
  users,
  myRole,
  hostedSignIn,
  canManageUsers,
  canRemoveUsers,
  assignableRoles,
  selectedUserId,
  onViewAccess,
  onInvite,
  onEdit,
  onSecurityDisable,
}: {
  users: WorkspaceUser[] | undefined;
  myRole: string | null;
  hostedSignIn: boolean;
  canManageUsers: boolean;
  canRemoveUsers: boolean;
  assignableRoles: string[];
  selectedUserId: string | null;
  onViewAccess: (userId: string) => void;
  onInvite: (user: WorkspaceUser) => void;
  onEdit: (user: WorkspaceUser) => void;
  onSecurityDisable: (user: WorkspaceUser) => void;
}) {
  const remove = useMutation(api.users.remove);
  const toast = useToast();
  const confirm = useConfirm();
  const records = useMemo<RosterRecord[]>(
    () => (users ?? []).map((user) => {
      const statusLabel = membershipStatusLabel(user, hostedSignIn);
      return {
        ...user,
        accessStatus: user.mergedIntoUserId ? "Merged" : statusLabel,
        statusLabel,
        _searchText: statusLabel,
      };
    }),
    [users, hostedSignIn],
  );
  const ownerCount = records.filter((user) => user.role === "Owner" && (!user.status || user.status === "Active")).length;
  const isLastOwner = (user: RosterRecord) => user.role === "Owner" && (!user.status || user.status === "Active") && ownerCount <= 1;
  const mayManage = (user: RosterRecord) => canManageUsers && (myRole === "Owner" || !["Owner", "Admin"].includes(user.role));

  const removeUser = async (user: RosterRecord) => {
    const ok = await confirm({
      title: "Remove user access?",
      message: `${user.displayName} will be removed from this workspace user table. This does not delete related member, director, or audit records.`,
      confirmLabel: "Remove access",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await remove({ id: user._id });
      toast.success("User access removed");
    } catch (error) {
      toast.error("Couldn't remove user", error instanceof Error ? error.message : String(error));
    }
  };

  const roleSelect = (user: RosterRecord) => (
    <UserRoleSelect user={user} lastOwner={isLastOwner(user)} disabled={!mayManage(user)} assignableRoles={assignableRoles} />
  );

  const renderCell = ({ record: user, field }: { record: RosterRecord; field: FieldMetadata }) => {
    switch (field.name) {
      case "displayName":
        return (
          <div className="users-table__who">
            <Avatar label={user.displayName || user.email || "?"} />
            <span className="record-table__identifier-lines">
              <strong className="record-table__identifier-primary">{user.displayName}</strong>
              <span className="record-table__identifier-secondary" title={user.email}>{user.email}</span>
              {hostedSignIn && !user.authSubject && <span className="record-table__identifier-secondary">No linked sign-in</span>}
            </span>
          </div>
        );
      case "role":
        return roleSelect(user);
      case "accessStatus":
        return <Badge tone={userStatusTone(user.statusLabel)}>{user.statusLabel}</Badge>;
      case "lastLoginAtISO":
        return <span>{user.lastLoginAtISO ? formatDate(user.lastLoginAtISO) : "—"}</span>;
      default:
        return undefined;
    }
  };

  const rowMenuSections = (record: RosterRecord): MenuSection[] => {
    const status = record.status ?? "Active";
    // A duplicate retired by an operator stays only so history keeps resolving.
    const retired = Boolean(record.mergedIntoUserId);
    const manage = mayManage(record);
    const lastOwner = isLastOwner(record);
    const candidates: (MenuItem | false)[] = [
      canManageUsers && { id: "access", label: "View module access", icon: <ShieldCheck size={14} />, onSelect: () => onViewAccess(record._id) },
      manage && !retired && hostedSignIn && !record.authSubject && !record.authIssuer && !["Disabled", "Suspended"].includes(status) && { id: "invite", label: "Invite to join", icon: <PlusCircle size={14} />, onSelect: () => onInvite(record) },
      manage && !retired && { id: "edit", label: "Edit user", icon: <Pencil size={14} />, onSelect: () => onEdit(record) },
      manage && !retired && status !== "Disabled" && { id: "disable", label: "Security disable", icon: <ShieldOff size={14} />, onSelect: () => onSecurityDisable(record) },
      !retired && {
        id: "remove",
        label: "Remove access",
        icon: <Trash2 size={14} />,
        destructive: true,
        disabled: lastOwner || !canRemoveUsers,
        hint: lastOwner ? "last owner" : !canRemoveUsers ? "owners only" : undefined,
        onSelect: () => void removeUser(record),
      },
    ];
    return [{ id: "user", items: candidates.filter((item): item is MenuItem => item !== false) }];
  };

  const renderRowActions = (record: RosterRecord) => hostedSignIn ? null : (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      onClick={() => {
        setStoredUserId(record._id);
        toast.success(
          `Now acting as ${record.displayName}`,
          isStaticDemoRuntime() ? "Demo preview: this resets to the owner when the page reloads." : undefined,
        );
      }}
      title="Act as this user"
    >
      <KeyRound size={12} /> Act as
    </button>
  );

  // Phones: who on the card with the role still changed in place; the actions sit behind its "…".
  const renderPhoneCard = (user: RosterRecord, { selecting }: RecordTableCardHelpers) => {
    const status = user.status ?? "Active";
    return (
      <RecordTablePhoneCard
        title={user.displayName}
        recordName={user.displayName}
        badge={roleSelect(user)}
        meta={[user.email]}
        detail={[
          status !== "Active" ? <Badge tone={status === "Invited" ? "warn" : "neutral"}>{user.mergedIntoUserId ? user.statusLabel : status}</Badge> : "",
          hostedSignIn && !user.authSubject ? "No linked sign-in" : "",
        ]}
        selecting={selecting}
      />
    );
  };

  return (
    <RecordListTable<RosterRecord>
      variant="card"
      table={ROSTER_TABLE}
      tableId="users-roster"
      label="All users"
      icon={<UserCog size={14} />}
      records={records}
      loading={users === undefined}
      // The user whose module access the viewer below the roster shows.
      highlightedRecordId={selectedUserId}
      renderCell={renderCell}
      renderRowActions={renderRowActions}
      rowMenuSections={rowMenuSections}
      renderPhoneCard={renderPhoneCard}
      emptyState={<RecordTableEmpty title="No users yet." description="Add one to start testing role-based access." />}
    />
  );
}

const MFA_OPTIONS: Array<{ value: WorkspaceMfaPolicy; label: string }> = [
  { value: "optional", label: "Optional" },
  { value: "owners-admins", label: "Owners and Admins" },
  { value: "everyone", label: "Everyone" },
];

function WorkspaceMfaSettings({ societyId }: { societyId: Id<"societies"> }) {
  const auth = useAuth();
  const current = useQuery(api.workspaceMfa.getPolicy, { societyId }) as WorkspaceMfaPolicy | undefined;
  const setPolicy = useMutation(api.workspaceMfa.setPolicy);
  const [draft, setDraft] = useState<WorkspaceMfaPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const selection = draft ?? current ?? "optional";

  return (
    <section className="card" aria-labelledby="workspace-mfa-title">
      <div className="card__head"><h2 className="card__title" id="workspace-mfa-title">Require 2FA</h2></div>
      <div className="card__body">
        <p>Choose who must verify a second factor to access this workspace. Each of their other workspaces has its own policy.</p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Select aria-label="Require 2FA" options={MFA_OPTIONS} value={selection} onChange={setDraft}
            disabled={current === undefined || saving} />
          <button className="btn btn--accent" type="button"
            disabled={current === undefined || selection === current || saving || !auth.secondFactorVerified}
            onClick={async () => {
              setSaving(true);
              try {
                await setPolicy({ societyId, policy: selection });
                setDraft(null);
                toast.success("Workspace 2FA policy saved");
              } catch (error) {
                toast.error("Could not save the 2FA policy", error instanceof Error ? error.message : undefined);
              } finally {
                setSaving(false);
              }
            }}>Save 2FA policy</button>
        </div>
        {!auth.secondFactorVerified && <>
          <p className="muted">Verify a second factor in your own session before changing this policy.</p>
          <WorkspaceMfaActions />
        </>}
      </div>
    </section>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function roleSummary(role?: string | null): string {
  switch (role) {
    case "Owner":
      return "Owner: full access, including inviting/removing users and changing roles.";
    case "Admin":
      return "Admin: can manage workspace records, users, and settings. Owner-only settings remain restricted.";
    case "Director":
      return "Director: can read workspace records and edit meetings, minutes, agendas, and documents under the role policy.";
    case "Member":
      return "Member: read-only access to the shared records included in the role policy.";
    case "Viewer":
      return "Viewer: read-only access across the workspace under the role policy.";
    default:
      return role ? `${role}: role-based access.` : "No role assigned.";
  }
}

/** An invitation as invitations:list returns it. */
type Invitation = {
  _id: string;
  kind?: "email" | "link";
  email?: string;
  label?: string;
  role: string;
  createdAtISO: string;
  expiresAtISO?: string;
  acceptedAtISO?: string;
  revokedAtISO?: string;
  acceptedBy?: { displayName: string; email: string };
  emailStatus?: string;
  emailProvider?: string;
  emailError?: string;
  emailRequestedAtMs?: number;
};
type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";
type InvitationRecord = Invitation & {
  invitee: string;
  inviteKind: "email" | "link";
  status: InvitationStatus;
  emailState: string;
  _searchText: string;
};

function invitationStatus(inv: Invitation, now: number): InvitationStatus {
  return inv.acceptedAtISO
    ? "accepted"
    : inv.revokedAtISO
      ? "revoked"
      : !inv.expiresAtISO || Date.parse(inv.expiresAtISO) <= now
        ? "expired" : "pending";
}

function invitationTone(status: InvitationStatus): ToneVariant {
  return status === "accepted" ? "success" : status === "revoked" ? "danger" : "warn";
}

/** How the invitation went out, as its Email column says it. */
function invitationEmailState(inv: Invitation): string {
  if (inv.kind === "link") return "Send link yourself";
  if (inv.emailStatus === "accepted") return inv.emailProvider === "demo" ? "Simulated (demo)" : "Accepted by mail provider";
  if (inv.emailStatus === "queued") return "Queued";
  if (inv.emailStatus === "failed") return "Email failed — resend";
  return "Not emailed yet";
}

const INVITATIONS_TABLE = staticRecordTable({
  id: "users-invitations",
  nameSingular: "workspaceInvitation",
  namePlural: "workspaceInvitations",
  labelSingular: "Invitation",
  labelPlural: "Invitations",
  labelIdentifierFieldName: "invitee",
  fields: [
    { name: "invitee", label: "Invitee", fieldType: FIELD_TYPES.TEXT, size: 300, config: { groupable: false } },
    {
      name: "inviteKind",
      label: "Type",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      isVisible: false,
      config: { options: [{ value: "email", label: "Email invitation", color: "blue" }, { value: "link", label: "Share link", color: "purple" }] },
    },
    { name: "role", label: "Role", fieldType: FIELD_TYPES.SELECT, size: 120, config: { options: ROLE_OPTIONS } },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 120,
      config: {
        options: [
          { value: "pending", label: "Pending", color: "amber" },
          { value: "accepted", label: "Accepted", color: "green" },
          { value: "expired", label: "Expired", color: "amber" },
          { value: "revoked", label: "Revoked", color: "red" },
        ],
      },
    },
    { name: "createdAtISO", label: "Created", fieldType: FIELD_TYPES.DATE, size: 160 },
    { name: "expiresAtISO", label: "Expires", fieldType: FIELD_TYPES.DATE, size: 140, isVisible: false },
    { name: "emailState", label: "Email", fieldType: FIELD_TYPES.TEXT, size: 200 },
  ],
});

function InvitationsPanel({
  societyId, assignableRoles,
}: {
  societyId: Id<"societies">;
  assignableRoles: string[];
}) {
  const hosted = useAuth().mode !== "none";
  const invitations = useQuery(api.invitations.list, { societyId });
  const create = useMutation(api.invitations.create);
  const revokeInvite = useMutation(api.invitations.revoke);
  const resendInvite = useMutation(api.invitations.resend);
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState<InviteForm | null>(null);
  const [issuedTokens, setIssuedTokens] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // ?intent=invite (from the "Invite teammate" command palette action) opens
  // the invite form.
  const inviteIntentHandled = useRef(false);
  useEffect(() => {
    if (searchParams.get("intent") !== "invite") {
      inviteIntentHandled.current = false;
      return;
    }
    if (inviteIntentHandled.current) return;
    inviteIntentHandled.current = true;
    setForm({ ...NEW_INVITE, email: searchParams.get("inviteEmail") ?? "", role: assignableRoles.includes(searchParams.get("inviteRole") ?? "") ? searchParams.get("inviteRole")! : "Member", targetUserId: searchParams.get("inviteUserId") ?? undefined });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      next.delete("inviteEmail"); next.delete("inviteRole"); next.delete("inviteUserId");
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const invite = async () => {
    if (!form || sending || (form.kind === "email" && !form.email.trim())) return;
    setSending("new");
    try {
    const issued = await create(form.kind === "link"
      ? { societyId, kind: "link", role: form.role, expiresInDays: form.expiresInDays, ...(form.label.trim() ? { label: form.label.trim() } : {}) }
      : { societyId, email: form.email.trim(), role: form.role, expiresInDays: form.expiresInDays, ...(form.targetUserId ? { targetUserId: form.targetUserId } : {}) });
    setIssuedTokens((previous) => ({ ...previous, [issued.id]: issued.token }));
    setForm(null);
    // The secret is only available now; copy it while the click still counts as a user gesture.
    if (form.kind === "link" || !hosted) await copyInvitationLink(issued.token, "Invitation link copied — send it to the person you're inviting");
    else toast.success("Invitation queued for email", "The invitation appears in their account after they verify their email. No workspace creation is needed.");
    } catch (error) { toast.error("Could not create invitation", error instanceof Error ? error.message : String(error)); }
    finally { setSending(null); }
  };

  const records = useMemo<InvitationRecord[]>(
    () => ((invitations ?? []) as Invitation[]).map((inv) => ({
      ...inv,
      invitee: inv.kind === "link" ? inv.label || "Anyone with the link" : inv.email ?? "",
      inviteKind: inv.kind === "link" ? "link" : "email",
      status: invitationStatus(inv, now),
      emailState: invitationEmailState(inv),
      _searchText: inv.acceptedBy ? `Joined as ${inv.acceptedBy.displayName} (${inv.acceptedBy.email})` : "",
    })),
    [invitations, now],
  );

  const copyInvitationLink = async (token: string, copiedMessage = "Invitation link copied") => {
    const basePath = import.meta.env.BASE_URL.replace(/\/?$/, "/");
    const link = new URL(`${basePath}invite/${encodeURIComponent(token)}`, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(link);
      toast.success(copiedMessage);
    } catch {
      toast.error("Could not copy the invitation link", "Use the copy button in the invitations list before leaving this page.");
    }
  };

  const renderCell = ({ record: inv, field }: { record: InvitationRecord; field: FieldMetadata }) => {
    switch (field.name) {
      case "invitee":
        return (
          <span className="record-table__identifier-lines">
            <span className="record-table__identifier-primary">
              {inv.kind === "link"
                ? <><Badge>Share link</Badge> <span className="muted">{inv.invitee}</span></>
                : <span className="mono">{inv.email}</span>}
            </span>
            {inv.acceptedBy && <span className="record-table__identifier-secondary">Joined as {inv.acceptedBy.displayName} ({inv.acceptedBy.email})</span>}
          </span>
        );
      case "role":
        return <Badge>{inv.role}</Badge>;
      case "status":
        return <Badge tone={invitationTone(inv.status)}>{inv.status}</Badge>;
      case "createdAtISO":
        return (
          <span className="record-table__identifier-lines">
            <span className="record-table__identifier-primary muted">{formatDate(inv.createdAtISO)}</span>
            <span className="record-table__identifier-secondary">{inv.expiresAtISO ? `Expires ${formatDate(inv.expiresAtISO)}` : "Reissue required"}</span>
          </span>
        );
      case "emailState":
        return inv.kind !== "link" && inv.emailStatus === "failed" ? <span title={inv.emailError}>{inv.emailState}</span> : <span>{inv.emailState}</span>;
      default:
        return undefined;
    }
  };

  const renderRowActions = (inv: InvitationRecord) => (
    <>
      {inv.kind !== "link" && !inv.acceptedAtISO && !inv.revokedAtISO && <button type="button" className="btn btn--sm" disabled={sending !== null || now - Number(inv.emailRequestedAtMs ?? 0) < 60_000} onClick={async () => {
        setSending(inv._id);
        try { const issued = await resendInvite({ id: inv._id }); setIssuedTokens(previous => ({ ...previous, [issued.id]: issued.token })); toast.success("Invitation queued again", "A new email link replaces the previous one."); }
        catch (cause) { toast.error("Could not resend invitation", cause instanceof Error ? cause.message : String(cause)); }
        finally { setSending(null); }
      }}>{sending === inv._id ? "Sending…" : "Resend email"}</button>}
      {inv.status === "pending" && (
        <>
          <button
            type="button"
            className="btn btn--sm btn--ghost btn--icon"
            aria-label="Copy invitation link"
            disabled={!issuedTokens[inv._id]}
            title={issuedTokens[inv._id] ? "Copy the newly issued invitation link" : "Invitation secrets are shown once. Revoke and reissue to create a new link."}
            onClick={() => void copyInvitationLink(issuedTokens[inv._id])}
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost btn--icon"
            aria-label="Revoke invitation"
            onClick={async () => {
              const ok = await confirm({
                title: "Revoke invitation?",
                message: inv.kind === "link"
                  ? "The share link will stop working."
                  : `The pending invitation for ${inv.email} will be cancelled.`,
                confirmLabel: "Revoke",
                tone: "danger",
              });
              if (!ok) return;
              await revokeInvite({ id: inv._id });
            }}
          >
            <Trash2 size={12} />
          </button>
        </>
      )}
    </>
  );

  // Phones: who and the status, then role and dates, then how it went out; the actions sit behind its "…".
  const renderPhoneCard = (inv: InvitationRecord, { selecting }: RecordTableCardHelpers) => {
    return (
      <RecordTablePhoneCard
        title={inv.kind === "link" ? `Share link · ${inv.invitee}` : inv.invitee}
        recordName={inv.invitee}
        badge={<Badge tone={invitationTone(inv.status)}>{inv.status}</Badge>}
        meta={[inv.role, formatDate(inv.createdAtISO), inv.expiresAtISO ? `Expires ${formatDate(inv.expiresAtISO)}` : "Reissue required"]}
        detail={[inv.acceptedBy ? `Joined as ${inv.acceptedBy.displayName}` : inv.emailState]}
        selecting={selecting}
      />
    );
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card__head users-invitations__head">
        <h2 className="card__title">Invitations</h2>
        <span className="card__subtitle">
          {hosted ? "Email invitations are emailed even if the person has no account yet. They verify that email and join this workspace directly." : "Copy invitation links and send them to the person you're inviting."} Share links must be sent yourself and can't grant Owner or Admin.
        </span>
        <button
          className="btn-action btn-action--primary"
          style={{ marginLeft: "auto" }}
          onClick={() => setForm(NEW_INVITE)}
        >
          <PlusCircle size={12} /> Invite
        </button>
      </div>
      <RecordListTable<InvitationRecord>
        variant="card"
        table={INVITATIONS_TABLE}
        tableId="users-invitations"
        label="All invitations"
        icon={<UserCog size={14} />}
        records={records}
        loading={invitations === undefined}
        renderCell={renderCell}
        renderRowActions={renderRowActions}
        renderPhoneCard={renderPhoneCard}
        emptyState={<RecordTableEmpty title="No invitations yet." />}
      />

      <Drawer
        open={!!form}
        onClose={() => setForm(null)}
        title="Invite a user"
        footer={
          <>
            <button className="btn" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn btn--accent" onClick={invite} disabled={sending !== null || !form || (form.kind === "email" && !form.email.trim())}>
              {sending === "new" ? "Creating…" : form?.kind === "link" ? "Create share link" : "Send invitation"}
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Who can use it">
              <Select
                value={form.kind}
                onChange={(v) => {
                  const kind = v as InviteForm["kind"];
                  const role = kind === "link" && !LINK_ROLES.includes(form.role) ? "Member" : form.role;
                  setForm({ ...form, kind, role });
                }}
                options={[
                  { value: "email", label: "Only this email address" },
                  { value: "link", label: "Anyone with the link" },
                ]}
              />
            </Field>
            {form.kind === "email" ? (
              <Field label="Email">
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value, targetUserId: undefined })}
                />
              </Field>
            ) : (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Whoever opens this link first while signed in joins the workspace. Share it only with the person
                  you mean to invite. It can grant Director, Member or Viewer; promote them after they join if needed.
                </p>
                <Field label="Note (optional)">
                  <input
                    className="input"
                    value={form.label}
                    maxLength={120}
                    placeholder="Who it's for, e.g. Sam, new treasurer"
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                  />
                </Field>
              </>
            )}
            <Field label="Expires in">
              <Select value={String(form.expiresInDays)} onChange={(v) => setForm({ ...form, expiresInDays: Number(v) })} options={[1, 7, 14, 30].map((days) => ({ value: String(days), label: `${days} day${days === 1 ? "" : "s"}` }))} />
            </Field>
            <Field label="Role">
              <Select
                value={form.role}
                disabled={!!form.targetUserId}
                onChange={(v) => setForm({ ...form, role: v })}
                options={assignableRoles.filter((r) => form.kind === "email" || LINK_ROLES.includes(r)).map((r) => ({ value: r, label: r }))}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
