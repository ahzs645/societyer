import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { RecordShowPage } from "../components/RecordShowPage";
import { CustomFieldsPanel } from "../components/CustomFieldsPanel";
import { NotesPanel } from "../components/NotesPanel";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { useTrackRecentRecord } from "../hooks/useTrackRecentRecord";
import { ArrowLeft, Users, MessageSquare, Activity, Sparkles } from "lucide-react";
import { formatDate } from "../lib/format";

export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  // Reuse the already-mirrored register query and resolve by id, so the detail
  // page works in the offline/demo runtime without a new backend query.
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");

  const member = ((members ?? []) as any[]).find((m) => String(m._id) === String(id));
  const fullNameOrNull = member ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || "Member" : null;
  // Hook must run on every render (it no-ops until args are ready) — keep it
  // above the conditional returns to satisfy the rules of hooks.
  useTrackRecentRecord("member", member?._id ? String(member._id) : null, fullNameOrNull, member?._id ? `/app/members/${member._id}` : null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (members === undefined) return <PageLoading />;

  if (!member) {
    return (
      <div className="page">
        <Link to="/app/members" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
          <ArrowLeft size={12} /> All members
        </Link>
        <div className="empty-state">Member not found in this society's register.</div>
      </div>
    );
  }

  const fullName = fullNameOrNull ?? "Member";
  const aliases = (member.aliases ?? []).filter(Boolean);

  const overview = (
    <div className="col" style={{ gap: 16 }}>
      <div className="card">
        <div className="card__head"><h2 className="card__title">Contact</h2></div>
        <div className="card__body col" style={{ gap: 6 }}>
          <Detail label="Email" value={member.email} />
          <Detail label="Phone" value={member.phone} />
          <Detail label="Address" value={member.address} />
          {aliases.length > 0 && <Detail label="Also known as" value={aliases.join(", ")} />}
        </div>
      </div>
      <div className="card">
        <div className="card__head"><h2 className="card__title">Membership</h2></div>
        <div className="card__body col" style={{ gap: 6 }}>
          <Detail label="Class" value={member.membershipClass} />
          <Detail label="Status" value={member.status} />
          <Detail label="Voting rights" value={member.votingRights ? "Yes" : "No"} />
          <Detail label="Joined" value={member.joinedAt ? formatDate(member.joinedAt) : undefined} />
          {member.leftAt && <Detail label="Left" value={formatDate(member.leftAt)} />}
        </div>
      </div>
      {member.notes && (
        <div className="card">
          <div className="card__head"><h2 className="card__title">Notes</h2></div>
          <div className="card__body" style={{ whiteSpace: "pre-wrap", color: "var(--text-secondary)" }}>
            {member.notes}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="page">
      <Link to="/app/members" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> All members
      </Link>
      <RecordShowPage
        title={fullName}
        icon={<Users size={16} />}
        iconColor="blue"
        subtitle={member.email ?? undefined}
        chips={
          <>
            <Badge tone={member.status === "Active" ? "success" : "warn"}>{member.status}</Badge>
            <Badge>{member.membershipClass}</Badge>
            {member.votingRights && <Badge tone="info">Voting</Badge>}
          </>
        }
        summary={[
          { label: "Class", value: member.membershipClass ?? "—" },
          { label: "Status", value: member.status ?? "—" },
          { label: "Joined", value: member.joinedAt ? formatDate(member.joinedAt) : "—" },
          { label: "Voting", value: member.votingRights ? "Yes" : "No" },
        ]}
        actions={
          <Link className="btn-action" to="/app/members">
            Open in register
          </Link>
        }
        tabs={[
          { id: "overview", label: "Overview", content: overview },
          {
            id: "custom",
            label: "Custom fields",
            icon: <Sparkles size={12} />,
            content: (
              <CustomFieldsPanel societyId={society._id} entityType="members" entityId={member._id} />
            ),
          },
          {
            id: "notes",
            label: "Notes",
            icon: <MessageSquare size={12} />,
            content: <NotesPanel entityType="member" entityId={String(member._id)} />,
          },
          {
            id: "activity",
            label: "Activity",
            icon: <Activity size={12} />,
            content: <ActivityTimeline entityType="member" entityId={String(member._id)} />,
          },
        ]}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="muted" style={{ minWidth: 120 }}>{label}</span>
      <span>{value || "—"}</span>
    </div>
  );
}
