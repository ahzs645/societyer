import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Pencil } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge, Drawer, Field } from "./ui";
import { Select } from "./Select";
import { Toggle } from "./Controls";
import { useToast } from "./Toast";
import { useConfirm } from "./Modal";
import { formatDate } from "../lib/format";
import { originHost } from "../lib/workspaceDomain";

// Owner is never granted from a request; promote after they join.
const ACCESS_REQUEST_ROLES = ["Admin", "Director", "Member", "Viewer"];
type DefaultRole = "Viewer" | "Member";
type AccessRequestRow = {
  id: string; status: "pending" | "approved" | "declined" | "withdrawn"; email?: string; emailVerified: boolean; name?: string; note?: string;
  createdAtISO: string; decidedAtISO?: string; grantedRole?: string; decidedBy?: string;
};
type AccessRequestSettings = { enabled: boolean; defaultRole: DefaultRole; message?: string; requestOrigin?: string };
type SettingsForm = { enabled: boolean; defaultRole: DefaultRole; message: string };
const DECISION_FAILURES: Record<string, string> = {
  "not-pending": "This request was already decided or withdrawn.",
  "already-member": "This person already has a membership here.",
  "identity-disabled": "This person's sign-in is disabled.",
  "email-in-use": "Another user here already uses this email. Edit or remove that user first.",
};

/**
 * Users & access: requests to join from this workspace's own web address, and
 * the setting that allows them (docs/shared-workspaces/user-guide.md). Hosted only.
 */
export function AccessRequestsPanel({ societyId, assignableRoles }: { societyId: Id<"societies">; assignableRoles: string[] }) {
  const requests = useQuery(api.accessRequests.listForWorkspace, { societyId }) as AccessRequestRow[] | undefined;
  const settings = useQuery(api.accessRequests.getSettings, { societyId }) as AccessRequestSettings | undefined;
  const approve = useMutation(api.accessRequests.approve);
  const decline = useMutation(api.accessRequests.decline);
  const toast = useToast();
  const confirm = useConfirm();
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const approverRoles = assignableRoles.filter((role) => ACCESS_REQUEST_ROLES.includes(role));
  const rows = requests ?? [];
  const pendingCount = rows.filter((request) => request.status === "pending").length;
  const host = originHost(settings?.requestOrigin);
  const who = (request: AccessRequestRow) => request.email ?? request.name ?? "this person";
  const roleFor = (request: AccessRequestRow) => roles[request.id] ?? settings?.defaultRole ?? "Viewer";

  const decide = async (request: AccessRequestRow, approved: boolean) => {
    const role = roleFor(request);
    if (!approved && !await confirm({
      title: "Decline request?",
      message: `${who(request)} won't be added. They'll see that the request was declined.`,
      confirmLabel: "Decline",
      tone: "danger",
    })) return;
    setBusy(request.id);
    try {
      const result = (approved ? await approve({ id: request.id, role }) : await decline({ id: request.id })) as { status: string };
      if (result.status === "approved") toast.success("Request approved", `${who(request)} joined as ${role}.`);
      else if (result.status === "declined") toast.success("Request declined");
      else toast.error("Couldn't decide this request", DECISION_FAILURES[result.status]);
    } catch (error) {
      toast.error("Couldn't decide this request", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card__head users-invitations__head">
        <h2 className="card__title">Access requests</h2>
        {pendingCount > 0 && <Badge tone="warn">{pendingCount}</Badge>}
        <span className="card__subtitle">
          {settings === undefined ? null : !settings.enabled
            ? "Off. Turn on to let people ask to join."
            : host ? `On. People signed in at ${host} can ask to join.` : "On, but this workspace has no web address of its own, so nobody can ask yet."}
        </span>
        <button className="btn-action" style={{ marginLeft: "auto" }} disabled={settings === undefined} onClick={() => setEditing(true)}>
          <Pencil size={12} /> Settings
        </button>
      </div>
      {rows.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Person</th><th>Note</th><th>Sent</th><th>Role</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((request) => (
              <tr key={request.id}>
                <td>
                  <span className="mono">{request.email ?? "No email"}</span>
                  {request.name && request.name !== request.email && <div className="muted">{request.name}</div>}
                </td>
                <td className="muted">{request.note ?? "—"}</td>
                <td className="muted">{formatDate(request.createdAtISO)}</td>
                <td>
                  {request.status === "pending" ? (
                    <Select
                      size="sm"
                      value={roleFor(request)}
                      disabled={busy !== null}
                      onChange={(role) => setRoles((previous) => ({ ...previous, [request.id]: role }))}
                      aria-label={`Role for ${who(request)}`}
                      options={approverRoles.map((role) => ({ value: role, label: role }))}
                    />
                  ) : (
                    <Badge tone={request.status === "approved" ? "success" : "neutral"}>
                      {request.status === "approved" ? `Approved as ${request.grantedRole ?? "member"}` : "Declined"}
                    </Badge>
                  )}
                </td>
                <td className="table__actions">
                  {request.status === "pending" ? (
                    <>
                      <button className="btn btn--sm btn--accent" disabled={busy !== null} onClick={() => void decide(request, true)}>
                        {busy === request.id ? "Saving…" : "Approve"}
                      </button>
                      <button className="btn btn--sm btn--ghost" disabled={busy !== null} onClick={() => void decide(request, false)}>Decline</button>
                    </>
                  ) : (
                    <span className="muted">{[request.decidedBy, request.decidedAtISO && formatDate(request.decidedAtISO)].filter(Boolean).join(", ")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {settings && editing && (
        <SettingsDrawer societyId={societyId} settings={settings} host={host} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

function SettingsDrawer({ societyId, settings, host, onClose }: {
  societyId: Id<"societies">; settings: AccessRequestSettings; host: string | null; onClose: () => void;
}) {
  const saveSettings = useMutation(api.accessRequests.setSettings);
  const toast = useToast();
  const [form, setForm] = useState<SettingsForm>({ enabled: settings.enabled, defaultRole: settings.defaultRole, message: settings.message ?? "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const message = form.message.trim();
      await saveSettings({ societyId, enabled: form.enabled, defaultRole: form.defaultRole, ...(message ? { message } : {}) });
      toast.success("Access request settings saved");
      onClose();
    } catch (error) {
      toast.error("Couldn't save the settings", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title="Access request settings"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <Toggle
        checked={form.enabled}
        onChange={(enabled) => setForm({ ...form, enabled })}
        label="Let people ask to join"
        hint={host
          ? `Someone signed in at ${host} who isn't a member can send a request. Owners and Admins approve or decline it.`
          : "Requests only come from this workspace's own web address, and it doesn't have one yet. A deployment operator sets it up."}
      />
      <Field label="Suggested role" hint="Preselected when you approve. You can pick another role you're allowed to grant.">
        <Select
          value={form.defaultRole}
          onChange={(role) => setForm({ ...form, defaultRole: role === "Member" ? "Member" : "Viewer" })}
          options={[{ value: "Viewer", label: "Viewer" }, { value: "Member", label: "Member" }]}
        />
      </Field>
      <Field label="Message for people asking (optional)">
        <textarea
          className="input"
          rows={3}
          maxLength={500}
          value={form.message}
          placeholder="For example: tell us which committee you're on."
          onChange={(event) => setForm({ ...form, message: event.target.value })}
        />
      </Field>
    </Drawer>
  );
}
