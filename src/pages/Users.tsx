import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId, setStoredUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { UserCog, PlusCircle, Trash2, KeyRound } from "lucide-react";
import { useState } from "react";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthProvider";

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
                    onChange={(v) => setRole({ id: u._id, role: v, actingUserId })}
                    options={ROLES.map((r) => ({ value: r, label: r }))}
                  />
                </td>
                <td>
                  <Badge tone={u.status === "Active" ? "success" : u.status === "Invited" ? "warn" : "neutral"}>
                    {u.status}
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
                    onClick={() => remove({ id: u._id, actingUserId })}
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
