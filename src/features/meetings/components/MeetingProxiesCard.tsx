import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../../../convex/_generated/dataModel";
import { Badge, Field } from "../../../components/ui";
import { NameAutocomplete } from "../../../components/NameAutocomplete";
import { useToast } from "../../../components/Toast";
import { formatDate } from "../../../lib/format";
import { Users, Trash2, Ban } from "lucide-react";

function memberName(member: any): string {
  return `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
}

/**
 * Proxy designation manager for a single meeting. Lists proxies, lets the user
 * appoint/revoke them (the backend enforces the active bylaw rule set's proxy
 * limits), and shows live quorum math including valid proxies.
 */
export function MeetingProxiesCard({
  societyId,
  meetingId,
  members,
  presentCount,
  quorumRequired,
}: {
  societyId: Id<"societies">;
  meetingId: Id<"meetings">;
  members: any[];
  presentCount: number;
  quorumRequired?: number;
}) {
  const proxies = useQuery(api.proxies.forMeeting, { meetingId });
  const createProxy = useMutation(api.proxies.create);
  const revokeProxy = useMutation(api.proxies.revoke);
  const removeProxy = useMutation(api.proxies.remove);
  const toast = useToast();

  const memberOptions = useMemo(
    () => (members ?? []).map(memberName).filter(Boolean).sort(),
    [members],
  );
  const memberIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members ?? []) {
      const name = memberName(member).toLowerCase();
      if (name) map.set(name, member._id);
    }
    return map;
  }, [members]);

  const [grantor, setGrantor] = useState("");
  const [holder, setHolder] = useState("");
  const [instructions, setInstructions] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeProxies = (proxies ?? []).filter((proxy: any) => !proxy.revokedAtISO);
  const effective = presentCount + activeProxies.length;
  const quorumMet = quorumRequired != null ? effective >= quorumRequired : null;

  const save = async () => {
    if (saving) return;
    if (!grantor.trim() || !holder.trim()) {
      toast.error("Enter both the grantor and the proxy holder.");
      return;
    }
    setSaving(true);
    try {
      await createProxy({
        societyId,
        meetingId,
        grantorName: grantor.trim(),
        grantorMemberId: (memberIdByName.get(grantor.trim().toLowerCase()) as Id<"members">) || undefined,
        proxyHolderName: holder.trim(),
        proxyHolderMemberId: (memberIdByName.get(holder.trim().toLowerCase()) as Id<"members">) || undefined,
        instructions: instructions.trim() || undefined,
        signedAtISO: new Date().toISOString(),
      });
      setGrantor("");
      setHolder("");
      setInstructions("");
      setAdding(false);
      toast.success("Proxy appointed");
    } catch (error: any) {
      // Surface bylaw-rule violations (proxy voting disabled, holder must be a
      // member, per-grantor limit) raised by the mutation.
      toast.error(error?.message ? String(error.message).replace(/^.*Error:\s*/, "") : "Could not appoint proxy.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card__head">
        <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>
          <Users size={13} style={{ verticalAlign: -1, marginRight: 6 }} />
          Proxies
        </h3>
        {!adding && (
          <button className="btn-action" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)}>
            Appoint proxy
          </button>
        )}
      </div>
      <div className="card__body">
        <div className="meeting-proxy-quorum">
          <span>
            Members counted <strong>{presentCount}</strong>
          </span>
          <span>
            Active proxies <strong>{activeProxies.length}</strong>
          </span>
          <span>
            Effective total <strong>{effective}</strong>
            {quorumRequired != null ? <span className="muted"> / {quorumRequired} required</span> : null}
          </span>
          {quorumMet != null && (
            <Badge tone={quorumMet ? "success" : "danger"}>{quorumMet ? "Quorum met" : "Below quorum"}</Badge>
          )}
        </div>
        <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 0 }}>
          Proxies count toward quorum only where the bylaws permit; confirm against the active rule set.
        </p>

        {(proxies ?? []).length === 0 && !adding && (
          <p className="muted" style={{ margin: 0 }}>No proxies appointed for this meeting.</p>
        )}

        {(proxies ?? []).map((proxy: any) => (
          <div key={proxy._id} className="meeting-conflict-row">
            <div className="meeting-conflict-row__main">
              <strong>{proxy.grantorName}</strong>
              <span className="muted"> → {proxy.proxyHolderName}</span>
              {proxy.instructions ? (
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{proxy.instructions}</div>
              ) : null}
              <div className="meeting-conflict-row__badges">
                {proxy.revokedAtISO ? (
                  <Badge tone="danger">Revoked {formatDate(proxy.revokedAtISO)}</Badge>
                ) : (
                  <Badge tone="success">Active</Badge>
                )}
                {proxy.signedAtISO && <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>Signed {formatDate(proxy.signedAtISO)}</span>}
              </div>
            </div>
            <div className="meeting-conflict-row__actions">
              {!proxy.revokedAtISO && (
                <button className="btn-action" title="Revoke" aria-label="Revoke proxy" onClick={() => revokeProxy({ id: proxy._id })}>
                  <Ban size={12} />
                </button>
              )}
              <button className="btn-action" title="Remove" aria-label="Remove proxy" onClick={() => removeProxy({ id: proxy._id })}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}

        {adding && (
          <div className="meeting-conflict-form">
            <div className="row" style={{ gap: 12 }}>
              <Field label="Grantor (member giving proxy)">
                <NameAutocomplete value={grantor} onChange={setGrantor} options={memberOptions} placeholder="Member name…" />
              </Field>
              <Field label="Proxy holder">
                <NameAutocomplete value={holder} onChange={setHolder} options={memberOptions} placeholder="Who will vote…" />
              </Field>
            </div>
            <Field label="Instructions (optional)">
              <input
                className="input"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Vote in favour of the budget resolution"
              />
            </Field>
            <div className="row" style={{ gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn" onClick={() => { setAdding(false); }}>Cancel</button>
              <button className="btn btn--accent" onClick={save} disabled={saving}>
                {saving ? "Appointing…" : "Appoint"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
