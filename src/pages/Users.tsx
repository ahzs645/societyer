import { isStaticDemoRuntime } from "../lib/staticRuntime";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId, setStoredUserId } from "../hooks/useCurrentUser";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Avatar, Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { Copy, UserCog, Plus, PlusCircle, Trash2, KeyRound, ShieldCheck, ShieldOff, Pencil, MoreHorizontal } from "lucide-react";
import { Menu, type MenuItem } from "../components/Menu";
import { InfoPopover } from "../components/InfoPopover";
import { formatDate } from "../lib/format";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthProvider";
import { useConfirm } from "../components/Modal";
import { WorkspaceAccessViewer } from "../components/WorkspaceAccessViewer";
import { organizationKind } from "../../shared/organizationDomain";
import { hasErrors, validateWorkspaceUserInput, type FieldErrors } from "../../shared/recordValidation";

const ROLES = ["Owner", "Admin", "Director", "Member", "Viewer"];
// Share links admit whoever opens them, so they can't grant Owner or Admin.
const LINK_ROLES = ["Director", "Member", "Viewer"];
type InviteForm = { kind: "email" | "link"; email: string; label: string; role: string; expiresInDays: number };
const NEW_INVITE: InviteForm = { kind: "email", email: "", label: "", role: "Member", expiresInDays: 7 };

export function UsersPage() {
  const society = useSociety();
  const auth = useAuth();
  const { role: myRole, permissions, can, loaded: permissionsLoaded } = usePermissions();
  const canViewRoster = permissionsLoaded && can("users:read");
  const users = useQuery(
    api.users.list,
    society && canViewRoster ? { societyId: society._id } : "skip",
  );
  const upsert = useMutation(api.users.upsert);
  const setRole = useMutation(api.users.setRole);
  const remove = useMutation(api.users.remove);
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
  const confirm = useConfirm();

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
              onClick={() =>
                setDraft({
                  email: "",
                  displayName: "",
                  role: "Member",
                  status: "Active",
                })
              }
            >
              <Plus size={12} /> Add user
            </button>
          ) : undefined
        }
      />

      {society.accessRecoveryRequired && <div className="card"><div className="card__body">This workspace requires controlled access recovery. A security disable removed its last Active Owner. An authorized operator must establish a new owner; disabled identities keep no access.</div></div>}

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
              <code key={p} className="chip" style={{ fontSize: 11 }}>{p}</code>
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
        {canViewRoster && <table className="table table--comfortable users-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th className="users-table__wide">Status</th>
              <th className="users-table__wide">Last login</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => {
              const ownerCount = (users ?? []).filter((x) => x.role === "Owner" && (!x.status || x.status === "Active")).length;
              const isLastOwner = u.role === "Owner" && (!u.status || u.status === "Active") && ownerCount <= 1;
              const mayManage = canManageUsers && (myRole === "Owner" || !["Owner", "Admin"].includes(u.role));
              const lastOwnerHint = "Promote another user to Owner before changing or removing this one.";
              const status = u.status ?? "Active";
              const removeUser = async () => {
                const ok = await confirm({
                  title: "Remove user access?",
                  message: `${u.displayName} will be removed from this workspace user table. This does not delete related member, director, or audit records.`,
                  confirmLabel: "Remove access",
                  tone: "danger",
                });
                if (!ok) return;
                try {
                  await remove({ id: u._id });
                  toast.success("User access removed");
                } catch (error) {
                  toast.error("Couldn't remove user", error instanceof Error ? error.message : String(error));
                }
              };
              const rowActions: MenuItem[] = [
                canManageUsers && { id: "access", label: "View module access", icon: <ShieldCheck size={14} />, onSelect: () => setSelectedUserId(u._id) },
                mayManage && { id: "edit", label: "Edit user", icon: <Pencil size={14} />, onSelect: () => setDraft(u) },
                mayManage && status !== "Disabled" && { id: "disable", label: "Security disable", icon: <ShieldOff size={14} />, onSelect: () => setIncident({ id: u._id, name: u.displayName, reason: "" }) },
                {
                  id: "remove",
                  label: "Remove access",
                  icon: <Trash2 size={14} />,
                  destructive: true,
                  disabled: isLastOwner || !canRemoveUsers,
                  hint: isLastOwner ? "last owner" : !canRemoveUsers ? "owners only" : undefined,
                  onSelect: () => void removeUser(),
                },
              ].filter(Boolean) as MenuItem[];
              return (
              <tr key={u._id} className={selectedUserId === u._id ? "is-selected" : undefined}>
                <td>
                  <div className="users-table__who">
                    <Avatar label={u.displayName || u.email || "?"} />
                    <span className="users-table__identity">
                      <strong>{u.displayName}</strong>
                      <span className="users-table__email">{u.email}</span>
                    </span>
                    {status !== "Active" && (
                      <span className="users-table__narrow-status"><Badge tone={status === "Invited" ? "warn" : "neutral"}>{status}</Badge></span>
                    )}
                  </div>
                </td>
                <td className="users-table__role" title={isLastOwner ? lastOwnerHint : undefined}>
                  <Select
                    size="sm"
                    value={u.role}
                    disabled={isLastOwner || !mayManage}
                    onChange={async (v) => {
                      const ok = await confirm({
                        title: "Change user role?",
                        message: `${u.displayName} will change from ${u.role} to ${v}. Review whether this affects access to governance, finance, or public publishing workflows.`,
                        confirmLabel: "Change role",
                        tone: "warn",
                      });
                      if (!ok) return;
                      try {
                        await setRole({ id: u._id, role: v });
                        toast.success("Role updated");
                      } catch (error) {
                        toast.error("Couldn't change role", error instanceof Error ? error.message : String(error));
                      }
                    }}
                    aria-label={`Role for ${u.displayName}`}
                    options={assignableRoles.map((r) => ({ value: r, label: r }))}
                  />
                </td>
                <td className="users-table__wide">
                  <Badge tone={status === "Active" ? "success" : status === "Invited" ? "warn" : "neutral"}>
                    {status}
                  </Badge>
                </td>
                <td className="users-table__wide">{u.lastLoginAtISO ? formatDate(u.lastLoginAtISO) : "—"}</td>
                <td className="users-table__actions">
                  {auth.mode === "none" && (
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        setStoredUserId(u._id);
                        toast.success(
                          `Now acting as ${u.displayName}`,
                          isStaticDemoRuntime() ? "Demo preview: this resets to the owner when the page reloads." : undefined,
                        );
                      }}
                      title="Act as this user"
                    >
                      <KeyRound size={12} /> Act as
                    </button>
                  )}
                  <Menu
                    align="right"
                    minWidth={210}
                    trigger={
                      <button className="btn btn--ghost btn--sm btn--icon" aria-label={`More actions for ${u.displayName}`}>
                        <MoreHorizontal size={14} />
                      </button>
                    }
                    sections={[{ id: "user", items: rowActions }]}
                  />
                </td>
              </tr>
              );
            })}
            {(users ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No users yet. Add one to start testing role-based access.
                </td>
              </tr>
            )}
          </tbody>
        </table>}
      </div>

      {canManageUsers && users && users.length > 0 && (
        <WorkspaceAccessViewer
          users={users}
          selectedUserId={selectedUserId ?? actingUserId ?? users[0]._id}
          onSelectUser={setSelectedUserId}
          moduleSource={society}
          entityKind={organizationKind(society as any)}
        />
      )}

      {canManageUsers && (
        <InvitationsPanel societyId={society._id} assignableRoles={assignableRoles} />
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

function InvitationsPanel({
  societyId, assignableRoles,
}: {
  societyId: any;
  assignableRoles: string[];
}) {
  const invitations = useQuery(api.invitations.list, { societyId });
  const create = useMutation(api.invitations.create);
  const revokeInvite = useMutation(api.invitations.revoke);
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState<InviteForm | null>(null);
  const [issuedTokens, setIssuedTokens] = useState<Record<string, string>>({});

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
    setForm(NEW_INVITE);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const invite = async () => {
    if (!form || (form.kind === "email" && !form.email.trim())) return;
    try {
    const issued = await create(form.kind === "link"
      ? { societyId, kind: "link", role: form.role, expiresInDays: form.expiresInDays, ...(form.label.trim() ? { label: form.label.trim() } : {}) }
      : { societyId, email: form.email.trim(), role: form.role, expiresInDays: form.expiresInDays });
    setIssuedTokens((previous) => ({ ...previous, [issued.id]: issued.token }));
    setForm(null);
    // The secret is only available now; copy it while the click still counts as a user gesture.
    await copyInvitationLink(issued.token, "Invitation created and link copied — send it to the person you're inviting");
    } catch (error) { toast.error("Could not create invitation", error instanceof Error ? error.message : String(error)); }
  };

  const pending = (invitations ?? []).filter(
    (i: any) => !i.acceptedAtISO && !i.revokedAtISO && i.expiresAtISO && Date.parse(i.expiresAtISO) > Date.now(),
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

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Invitations</h2>
        <span className="card__subtitle">
          Email invitations require that verified email; share links admit whoever opens them and can't grant Owner or Admin. All invitations expire and work once. Links are available only when created.
        </span>
        <button
          className="btn-action btn-action--primary"
          style={{ marginLeft: "auto" }}
          onClick={() => setForm(NEW_INVITE)}
        >
          <PlusCircle size={12} /> Invite
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Invitee</th>
            <th>Role</th>
            <th>Status</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(invitations ?? []).map((inv: any) => {
            const status = inv.acceptedAtISO
              ? "accepted"
              : inv.revokedAtISO
                ? "revoked"
                : !inv.expiresAtISO || Date.parse(inv.expiresAtISO) <= Date.now()
                  ? "expired" : "pending";
            return (
              <tr key={inv._id}>
                <td>
                  {inv.kind === "link"
                    ? <><Badge>Share link</Badge> <span className="muted">{inv.label || "Anyone with the link"}</span></>
                    : <span className="mono">{inv.email}</span>}
                  {inv.acceptedBy && <div className="muted">Joined as {inv.acceptedBy.displayName} ({inv.acceptedBy.email})</div>}
                </td>
                <td><Badge>{inv.role}</Badge></td>
                <td>
                  <Badge tone={status === "accepted" ? "success" : status === "revoked" ? "danger" : "warn"}>
                    {status}
                  </Badge>
                </td>
                <td className="muted">{formatDate(inv.createdAtISO)}<div className="muted">{inv.expiresAtISO ? `Expires ${formatDate(inv.expiresAtISO)}` : "Reissue required"}</div></td>
                <td className="table__actions">
                  {status === "pending" && (
                    <>
                      <button
                        className="btn btn--sm btn--ghost btn--icon"
                        aria-label="Copy invitation link"
                        disabled={!issuedTokens[inv._id]}
                        title={issuedTokens[inv._id] ? "Copy the newly issued invitation link" : "Invitation secrets are shown once. Revoke and reissue to create a new link."}
                        onClick={() => void copyInvitationLink(issuedTokens[inv._id])}
                      >
                        <Copy size={12} />
                      </button>
                      <button
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
                </td>
              </tr>
            );
          })}
          {pending.length === 0 && (invitations ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 16 }}>
                No invitations yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Drawer
        open={!!form}
        onClose={() => setForm(null)}
        title="Invite a user"
        footer={
          <>
            <button className="btn" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn btn--accent" onClick={invite} disabled={!form || (form.kind === "email" && !form.email.trim())}>
              Create invitation
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
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
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
