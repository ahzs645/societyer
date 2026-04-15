import { Link, Navigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useAuth } from "../auth/AuthProvider";
import { ArrowLeft, Calendar, Vote, UserRound, HandHeart, BadgeDollarSign } from "lucide-react";
import { useModuleEnabled } from "../hooks/useModules";

export function PortalPage() {
  const auth = useAuth();
  const society = useSociety();
  const currentUser = useCurrentUser();
  const votingEnabled = useModuleEnabled("voting");
  const volunteersEnabled = useModuleEnabled("volunteers");
  const grantsEnabled = useModuleEnabled("grants");
  const member = useQuery(
    api.members.get,
    currentUser?.memberId ? { id: currentUser.memberId } : "skip",
  );
  const meetings = useQuery(
    api.meetings.list,
    society ? { societyId: society._id } : "skip",
  );
  const myElections = useQuery(
    api.elections.listMine,
    society && currentUser && votingEnabled
      ? { societyId: society._id, userId: currentUser._id }
      : "skip",
  );

  if (auth.mode !== "better-auth") {
    return <Navigate to="/app" replace />;
  }
  if (auth.isPending || society === undefined) {
    return <div className="page">Loading…</div>;
  }
  if (!auth.isAuthenticated || !society) {
    return <Navigate to="/login" replace />;
  }

  const upcomingGeneralMeetings = (meetings ?? [])
    .filter(
      (meeting: any) =>
        (meeting.type === "AGM" || meeting.type === "SGM") &&
        meeting.status === "Scheduled" &&
        new Date(meeting.scheduledAt).getTime() >= Date.now(),
    )
    .slice(0, 5);

  return (
    <div className="landing" style={{ minHeight: "100vh" }}>
      <section className="landing__hero" style={{ paddingTop: 64, paddingBottom: 64 }}>
        <div className="landing__container">
          <Link to="/app" className="row muted" style={{ marginBottom: 16, fontSize: 12 }}>
            <ArrowLeft size={12} /> Back to workspace
          </Link>

          <div className="landing__eyebrow">
            <UserRound size={12} /> Member portal
          </div>
          <h1 className="landing__h1" style={{ marginBottom: 12 }}>
            {currentUser?.displayName ?? auth.session?.user.name ?? auth.session?.user.email}
          </h1>
          <p className="landing__lede">
            Your member-facing view into {society.name}. Profile status, upcoming governance
            activity, and ballot access live here.
          </p>

          <div className="two-col" style={{ marginTop: 32 }}>
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Profile</h2>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 10 }}>
                <Row label="Email" value={currentUser?.email ?? auth.session?.user.email ?? "—"} />
                <Row label="Role" value={currentUser?.role ?? "—"} />
                <Row label="Membership class" value={member?.membershipClass ?? "Not linked"} />
                <Row label="Membership status" value={member?.status ?? "Not linked"} />
                <Row label="Voting rights" value={member?.votingRights ? "Yes" : "No"} />
              </div>
            </div>

            {votingEnabled && (
              <div className="card">
                <div className="card__head">
                  <h2 className="card__title">Ballots</h2>
                </div>
                <div className="card__body" style={{ display: "grid", gap: 10 }}>
                  {(myElections ?? []).length === 0 && (
                    <div className="muted">No active or assigned elections right now.</div>
                  )}
                  {(myElections ?? []).map((row: any) => (
                    <Link
                      key={row.election._id}
                      to={`/app/elections/${row.election._id}`}
                      className="panel"
                      style={{ padding: 12, borderRadius: 8 }}
                    >
                      <div className="row">
                        <strong>{row.election.title}</strong>
                        <Vote size={14} />
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        Status: {row.eligibility?.status ?? "Eligible"}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card__head">
              <h2 className="card__title">Upcoming member meetings</h2>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 10 }}>
              {upcomingGeneralMeetings.length === 0 && (
                <div className="muted">No upcoming AGM or special general meeting.</div>
              )}
              {upcomingGeneralMeetings.map((meeting: any) => (
                <div key={meeting._id} className="panel" style={{ padding: 12, borderRadius: 8 }}>
                  <div className="row">
                    <strong>{meeting.title}</strong>
                    <Calendar size={14} />
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {new Date(meeting.scheduledAt).toLocaleString()} · {meeting.location ?? "Location TBD"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {society.publicSlug && (volunteersEnabled || grantsEnabled) && (
            <div className="two-col" style={{ marginTop: 24 }}>
              {volunteersEnabled && (
                <div className="card">
                  <div className="card__head">
                    <h2 className="card__title">Volunteer intake</h2>
                  </div>
                  <div className="card__body" style={{ display: "grid", gap: 10 }}>
                    <div className="muted" style={{ fontSize: 13 }}>
                      Submit volunteer interest directly into the society intake queue.
                    </div>
                    <Link to={`/public/${society.publicSlug}/volunteer-apply`} className="btn btn--accent">
                      <HandHeart size={14} /> Apply to volunteer
                    </Link>
                  </div>
                </div>
              )}

              {grantsEnabled && (
                <div className="card">
                  <div className="card__head">
                    <h2 className="card__title">Funding intake</h2>
                  </div>
                  <div className="card__body" style={{ display: "grid", gap: 10 }}>
                    <div className="muted" style={{ fontSize: 13 }}>
                      Submit a grant or funding request without leaving the member portal flow.
                    </div>
                    <Link to={`/public/${society.publicSlug}/grant-apply`} className="btn btn--accent">
                      <BadgeDollarSign size={14} /> Submit funding request
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
