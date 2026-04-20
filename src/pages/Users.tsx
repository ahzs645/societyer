import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId, setStoredUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { UserCog, PlusCircle, Trash2, KeyRound } from "lucide-react";
import { useState } from "react";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthProvider";
import { useConfirm } from "../components/Modal";

const ROLES = ["Owner", "Admin", "Director", "Member", "Viewer"];

export function UsersPage() {
  const society = useSociety();
  const auth = useAuth();
  const users = useQuery(
    api.users.list,
    society ? { societyId: society._id } : "skip",
  );
  const upsert = useMutation(api.users.upsert);
  const setRole = useMutation(api.users.setRole);
  const remove = useMutation(api.users.remove);
  const actingUserId = useCurrentUserId() ?? undefined;
  const [draft, setDraft] = useState<any>(null);
  const toast = useToast();
  const confirm = useConfirm();

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Users & roles"
        icon={<UserCog size={16} />}
        iconColor="blue"
        subtitle={
          auth.mode === "better-auth"
            ? "Role-based access controls every write in the app. Better Auth resolves a real session into this workspace user table."
            : "Role-based access controls every write in the app. No-auth mode uses the local acting-user picker."
        }
        actions={
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
        }
      />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Users</h2>
          <span className="card__subtitle">
            Pick one from the header to act as them — Convex uses their role to authorize writes.
          </span>
        </div>
        <table className="table">
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
            {(users ?? []).map((u) => (
              <tr key={u._id}>
                <td>
                  <strong>{u.displayName}</strong>
                </td>
                <td className="mono">{u.email}</td>
                <td>
                  <Select
                    value={u.role}
                    onChange={async (v) => {
                      const ok = await confirm({
                        title: "Change user role?",
                        message: `${u.displayName} will change from ${u.role} to ${v}. Review whether this affects access to governance, finance, or public publishing workflows.`,
                        confirmLabel: "Change role",
                        tone: "warn",
                      });
                      if (!ok) return;
                      await setRole({ id: u._id, role: v, actingUserId });
                      toast.success("Role updated");
                    }}
                    options={ROLES.map((r) => ({ value: r, label: r }))}
                  />
                </td>
                <td>
                  <Badge tone={u.status === "Active" ? "success" : u.status === "Invited" ? "warn" : "neutral"}>
                    {u.status ?? "Active"}
                  </Badge>
                </td>
                <td className="mono">{u.lastLoginAtISO ?? "—"}</td>
                <td>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setStoredUserId(u._id);
                      toast.success(`Now acting as ${u.displayName}`);
                    }}
                    disabled={auth.mode === "better-auth"}
                    title="Act as this user"
                  >
                    <KeyRound size={12} /> Act as
                  </button>
                  <button
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label={`Remove user ${u.name ?? u.email}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Remove user access?",
                        message: `${u.displayName} will be removed from this workspace user table. This does not delete related member, director, or audit records.`,
                        confirmLabel: "Remove access",
                        tone: "danger",
                      });
                      if (!ok) return;
                      await remove({ id: u._id, actingUserId });
                      toast.success("User access removed");
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {(users ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No users yet. Add one to start testing role-based access.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <InvitationsPanel societyId={society._id} actingUserId={actingUserId} />

      <Drawer
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?._id ? "Edit user" : "Add user"}
        footer={
          <>
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsert({
                  id: draft._id,
                  societyId: society._id,
                  email: draft.email,
                  displayName: draft.displayName,
                  role: draft.role,
                  status: draft.status,
                  memberId: draft.memberId,
                  directorId: draft.directorId,
                  actingUserId,
                });
                toast.success("Saved");
                setDraft(null);
              }}
            >
              Save
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
                options={ROLES.map((r) => ({ value: r, label: r }))}
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
                ]}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function InvitationsPanel({
  societyId,
  actingUserId,
}: {
  societyId: any;
  actingUserId?: any;
}) {
  const invitations = useQuery(api.invitations.list, { societyId });
  const create = useMutation(api.invitations.create);
  const revokeInvite = useMutation(api.invitations.revoke);
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<{ email: string; role: string } | null>(null);

  const invite = async () => {
    if (!form?.email.trim()) return;
    await create({
      societyId,
      email: form.email.trim(),
      role: form.role,
      invitedByUserId: actingUserId,
    });
    setForm(null);
    toast.success("Invitation created");
  };

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const pending = (invitations ?? []).filter(
    (i: any) => !i.acceptedAtISO && !i.revokedAtISO,
  );

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Invitations</h2>
        <span className="card__subtitle">
          Invite by email — share the copy-link in the meantime.
        </span>
        <button
          className="btn-action btn-action--primary"
          style={{ marginLeft: "auto" }}
          onClick={() => setForm({ email: "", role: "Member" })}
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
                : "pending";
            return (
              <tr key={inv._id}>
                <td className="mono">{inv.email}</td>
                <td><Badge>{inv.role}</Badge></td>
                <td>
                  <Badge tone={status === "accepted" ? "success" : status === "revoked" ? "danger" : "warn"}>
                    {status}
                  </Badge>
                </td>
                <td className="mono muted">{inv.createdAtISO?.slice(0, 10)}</td>
                <td className="table__actions">
                  {status === "pending" && (
                    <>
                      <button
                        className="btn btn--sm btn--ghost"
                        onClick={() => copyLink(inv.token)}
                      >
                        Copy link
                      </button>
                      <button
                        className="btn btn--sm btn--ghost btn--icon"
                        aria-label="Revoke invitation"
                        onClick={async () => {
                          const ok = await confirm({
                            title: "Revoke invitation?",
                            message: `${inv.email} will no longer be able to use this link.`,
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
            <Field label="Role">
              <Select
                value={form.role}
                onChange={(v) => setForm({ ...form, role: v })}
                options={ROLES.map((r) => ({ value: r, label: r }))}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
