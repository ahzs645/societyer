import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser, useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { Vote, ArrowLeft } from "lucide-react";
import { useToast } from "../components/Toast";
import { isBetterAuthMode } from "../lib/authMode";

export function ElectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const electionBundle = useQuery(
    api.elections.get,
    id ? { id: id as Id<"elections"> } : "skip",
  );
  const tally = useQuery(
    api.elections.tally,
    id ? { electionId: id as Id<"elections"> } : "skip",
  );
  const currentUser = useCurrentUser();
  const actingUserId = useCurrentUserId() ?? undefined;
  const castBallot = useMutation(api.elections.castBallot);
  const toast = useToast();
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  const election = electionBundle?.election;
  const myEligibility = useMemo(() => {
    if (!currentUser?.memberId || !electionBundle?.eligible) return null;
    return (
      electionBundle.eligible.find(
        (row: any) => row.memberId === currentUser.memberId,
      ) ?? null
    );
  }, [currentUser?.memberId, electionBundle?.eligible]);

  if (electionBundle === undefined) return <div className="page">Loading…</div>;
  if (electionBundle === null || !election) return <SeedPrompt />;

  const canVote =
    isBetterAuthMode() &&
    election.status === "Open" &&
    !!currentUser?.memberId &&
    myEligibility &&
    myEligibility.status !== "Voted";

  const saveBallot = async () => {
    await castBallot({
      electionId: election._id,
      actingUserId,
      choices: electionBundle.questions.map((question: any) => ({
        questionId: question._id,
        optionIds: selected[question._id] ?? [],
      })),
    });
    toast.success("Ballot submitted");
  };

  return (
    <div className="page">
      <Link to="/app/elections" className="row muted" style={{ marginBottom: 12, fontSize: 12 }}>
        <ArrowLeft size={12} /> Back to elections
      </Link>
      <PageHeader
        title={election.title}
        icon={<Vote size={16} />}
        iconColor="purple"
        subtitle={`${new Date(election.opensAtISO).toLocaleString()} → ${new Date(
          election.closesAtISO,
        ).toLocaleString()}`}
      />

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Ballot</h2>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 16 }}>
              {!isBetterAuthMode() && (
                <div className="muted">
                  Real anonymous member voting is disabled in no-auth mode.
                </div>
              )}
              {electionBundle.questions.map((question: any) => (
                <div key={question._id} className="panel" style={{ padding: 12 }}>
                  <strong>{question.title}</strong>
                  {question.description && (
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                      {question.description}
                    </div>
                  )}
                  <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                    {question.options.map((option: any) => {
                      const values = selected[question._id] ?? [];
                      const checked = values.includes(option.id);
                      return (
                        <label key={option.id} className="checkbox">
                          <input
                            type={question.maxSelections > 1 ? "checkbox" : "radio"}
                            checked={checked}
                            name={question._id}
                            onChange={() => {
                              setSelected((current) => {
                                if (question.maxSelections > 1) {
                                  const next = checked
                                    ? values.filter((value) => value !== option.id)
                                    : [...values, option.id].slice(0, question.maxSelections);
                                  return { ...current, [question._id]: next };
                                }
                                return { ...current, [question._id]: [option.id] };
                              });
                            }}
                            disabled={!canVote}
                          />
                          {option.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              {canVote && (
                <button className="btn btn--accent" onClick={saveBallot}>
                  Submit anonymous ballot
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Eligibility</h2>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 8 }}>
              <Row
                label="Election status"
                value={<Badge tone={election.status === "Open" ? "success" : "warn"}>{election.status}</Badge>}
              />
              <Row
                label="Anonymous ballot"
                value={<Badge tone={election.anonymousBallot ? "success" : "warn"}>{election.anonymousBallot ? "Yes" : "No"}</Badge>}
              />
              <Row
                label="My status"
                value={
                  myEligibility ? (
                    <Badge tone={myEligibility.status === "Voted" ? "success" : "info"}>
                      {myEligibility.status}
                    </Badge>
                  ) : (
                    <Badge tone="danger">Not eligible</Badge>
                  )
                }
              />
              <div className="muted" style={{ fontSize: 13 }}>
                Eligibility is verified against the member register. The ballot itself is
                stored without a member identifier.
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Tally</h2>
              <span className="card__subtitle">
                {electionBundle.ballots.length} anonymous ballot(s)
              </span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 12 }}>
              {(tally ?? []).map((question: any) => (
                <div key={question.questionId}>
                  <strong>{question.title}</strong>
                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    {question.totals.map((total: any) => (
                      <Row key={total.id} label={total.label} value={`${total.votes} vote(s)`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Audit log</h2>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 8 }}>
              {electionBundle.audit.map((event: any) => (
                <div key={event._id} className="muted" style={{ fontSize: 13 }}>
                  <strong>{event.actorName}</strong> {event.action}
                  {event.detail ? ` — ${event.detail}` : ""} ·{" "}
                  {new Date(event.createdAtISO).toLocaleString()}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
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
