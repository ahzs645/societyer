import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId, setStoredUserId } from "../hooks/useCurrentUser";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { Copy, UserCog, PlusCircle, Trash2, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthProvider";
import { useConfirm } from "../components/Modal";
import { WorkspaceAccessViewer } from "../components/WorkspaceAccessViewer";

const ROLES = ["Owner", "Admin", "Director", "Member", "Viewer"];

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
            : "Manage workspace memberships and role policies. Use the local acting-user picker to preview a role."
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
              <PlusCircle size={12} /> Add user
            </button>
          ) : undefined
        }
      />

      {society.accessRecoveryRequired && <div className="card"><div className="card__body">This workspace requires controlled access recovery. A security disable removed its last Active Owner. An authorized operator must establish a new owner; disabled identities keep no access.</div></div>}

      {myRole && (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">
              <ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              Your access
            </h2>
            <Badge tone={myRole === "Owner" || myRole === "Admin" ? "success" : "info"}>{myRole}</Badge>
          </div>
          <div className="card__body">
            <div className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 6 }}>
              {roleSummary(myRole)}
              {!canManageUsers && (canViewRoster ? " You can view users but not change roles." : " Your role does not permit viewing the workspace roster.")}
            </div>
            <details>
              <summary className="muted" style={{ fontSize: "var(--fs-sm)", cursor: "pointer" }}>
                View all {permissions.length} permission{permissions.length === 1 ? "" : "s"}
              </summary>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                {permissions.map((p) => (
                  <code key={p} className="chip" style={{ fontSize: 11 }}>{p}</code>
                ))}
              </div>
            </details>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Users</h2>
          <span className="card__subtitle">
            {auth.mode === "none"
              ? "Pick a local acting user from the header to test workspace roles."
              : "Workspace roles and invitations control access for signed-in accounts."}
          </span>
        </div>
        {!permissionsLoaded && <p role="status" className="muted">Checking workspace access…</p>}
        {permissionsLoaded && !canViewRoster && <p role="status" className="muted">Your role does not permit viewing the workspace roster. Your own access is shown above.</p>}
        {canViewRoster && <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last login</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => {
              const ownerCount = (users ?? []).filter((x) => x.role === "Owner" && (!x.status || x.status === "Active")).length;
              const isLastOwner = u.role === "Owner" && (!u.status || u.status === "Active") && ownerCount <= 1;
              const mayManage = canManageUsers && (myRole === "Owner" || !["Owner", "Admin"].includes(u.role));
              const lastOwnerHint = "Promote another user to Owner before changing or removing this one.";
              return (
              <tr key={u._id}>
                <td>
                  <strong>{u.displayName}</strong>
                </td>
                <td className="mono">{u.email}</td>
                <td title={isLastOwner ? lastOwnerHint : undefined}>
                  <Select
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
                <td>
                  <Badge tone={u.status === "Active" ? "success" : u.status === "Invited" ? "warn" : "neutral"}>
                    {u.status ?? "Active"}
                  </Badge>
                </td>
                <td className="mono">{u.lastLoginAtISO ?? "—"}</td>
                <td>
                  {canManageUsers && <button className="btn btn--ghost btn--sm" aria-label={`View access for ${u.displayName}`} aria-pressed={selectedUserId === u._id} onClick={() => setSelectedUserId(u._id)}><ShieldCheck size={12} /> Access</button>}
                  {mayManage && <button className="btn btn--ghost btn--sm" onClick={() => setDraft(u)}>Edit access</button>}
                  {mayManage && u.status !== "Disabled" && <button className="btn btn--ghost btn--sm" onClick={() => setIncident({ id: u._id, name: u.displayName, reason: "" })}>Security disable</button>}
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setStoredUserId(u._id);
                      toast.success(`Now acting as ${u.displayName}`);
                    }}
                    disabled={auth.mode !== "none"}
                    title="Act as this user"
                  >
                    <KeyRound size={12} /> Act as
                  </button>
                  <button
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label={`Remove user ${u.name ?? u.email}`}
                    disabled={isLastOwner || !canRemoveUsers}
                    title={isLastOwner ? lastOwnerHint : !canRemoveUsers ? "Only an Owner can remove access." : undefined}
                    onClick={async () => {
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
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
              );
            })}
            {(users ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>
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
        onClose={() => setDraft(null)}
        title={draft?._id ? "Edit user" : "Add user"}
        footer={
          <>
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={saving}
              onClick={async () => {
                if (saving) return;
                setSaving(true);
                try {
                  await upsert({
                    id: draft._id,
                    societyId: society._id,
                    email: draft.email,
                    displayName: draft.displayName,
                    role: draft.role,
                    status: draft.status,
                    memberId: draft.memberId,
                    directorId: draft.directorId,
                  });
                  toast.success("Saved");
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
            <Field label="Display name">
              <input
                className="input"
                value={draft.displayName}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
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
  const [form, setForm] = useState<{ email: string; role: string; expiresInDays: number } | null>(null);
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
    setForm({ email: "", role: "Member", expiresInDays: 7 });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const invite = async () => {
    if (!form?.email.trim()) return;
    try {
    const issued = await create({
      societyId,
      email: form.email.trim(),
      role: form.role,
      expiresInDays: form.expiresInDays,
    });
    setIssuedTokens((previous) => ({ ...previous, [issued.id]: issued.token }));
    setForm(null);
    toast.success("Invitation created — copy the link before leaving this page");
    } catch (error) { toast.error("Could not create invitation", error instanceof Error ? error.message : String(error)); }
  };

  const pending = (invitations ?? []).filter(
    (i: any) => !i.acceptedAtISO && !i.revokedAtISO && i.expiresAtISO && Date.parse(i.expiresAtISO) > Date.now(),
  );

  const copyInvitationLink = async (token: string) => {
    const basePath = import.meta.env.BASE_URL.replace(/\/?$/, "/");
    const link = new URL(`${basePath}invite/${encodeURIComponent(token)}`, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invitation link copied");
    } catch {
      toast.error("Could not copy the invitation link");
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Invitations</h2>
        <span className="card__subtitle">
          Invitations require a verified email, expire automatically, and can be used once. Links are available only when created.
        </span>
        <button
          className="btn-action btn-action--primary"
          style={{ marginLeft: "auto" }}
          onClick={() => setForm({ email: "", role: "Member", expiresInDays: 7 })}
        >
          <PlusCircle size={12} /> Invite
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Email</th>
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
                <td className="mono">{inv.email}</td>
                <td><Badge>{inv.role}</Badge></td>
                <td>
                  <Badge tone={status === "accepted" ? "success" : status === "revoked" ? "danger" : "warn"}>
                    {status}
                  </Badge>
                </td>
                <td className="mono muted">{inv.createdAtISO?.slice(0, 10)}<div className="muted">Expires {inv.expiresAtISO?.slice(0, 10) ?? "Reissue required"}</div></td>
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
                            message: `The pending invitation for ${inv.email} will be cancelled.`,
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
            <button className="btn btn--accent" onClick={invite} disabled={!form?.email.trim()}>
              Create invitation
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Email">
              <input
                className="input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Expires in">
              <Select value={String(form.expiresInDays)} onChange={(v) => setForm({ ...form, expiresInDays: Number(v) })} options={[1, 7, 14, 30].map((days) => ({ value: String(days), label: `${days} day${days === 1 ? "" : "s"}` }))} />
            </Field>
            <Field label="Role">
              <Select
                value={form.role}
                onChange={(v) => setForm({ ...form, role: v })}
                options={assignableRoles.map((r) => ({ value: r, label: r }))}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
