import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser, useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { Vote, ArrowLeft, ShieldCheck, CheckCircle2, Lock } from "lucide-react";
import { useToast } from "../components/Toast";
import { isBetterAuthMode } from "../lib/authMode";
import { Select } from "../components/Select";

export function ElectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const currentUser = useCurrentUser();
  const actingUserId = useCurrentUserId() ?? undefined;
  const electionBundle = useQuery(
    api.elections.get,
    id
      ? { id: id as Id<"elections">, actingUserId: actingUserId as Id<"users"> | undefined }
      : "skip",
  );
  const tally = useQuery(
    api.elections.tally,
    id
      ? {
          electionId: id as Id<"elections">,
          actingUserId: actingUserId as Id<"users"> | undefined,
      }
      : "skip",
  );
  const nominations = useQuery(
    api.elections.listNominations,
    id
      ? {
          electionId: id as Id<"elections">,
          actingUserId: actingUserId as Id<"users"> | undefined,
        }
      : "skip",
  );
  const users = useQuery(
    api.users.list,
    electionBundle?.election
      ? { societyId: electionBundle.election.societyId }
      : "skip",
  );
  const documents = useQuery(
    api.documents.list,
    electionBundle?.election
      ? { societyId: electionBundle.election.societyId }
      : "skip",
  );
  const castBallot = useMutation(api.elections.castBallot);
  const closeElection = useMutation(api.elections.close);
  const tallyElection = useMutation(api.elections.tallyElection);
  const submitNomination = useMutation(api.elections.submitNomination);
  const reviewNomination = useMutation(api.elections.reviewNomination);
  const publishNominationToBallot = useMutation(api.elections.publishNominationToBallot);
  const updateSettings = useMutation(api.elections.updateSettings);
  const toast = useToast();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [nominationDraft, setNominationDraft] = useState({
    nomineeName: "",
    nomineeEmail: currentUser?.email ?? "",
    statement: "",
    questionId: "",
  });
  const [adminDraft, setAdminDraft] = useState<any | null>(null);

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
  const canManage =
    currentUser?.role === "Owner" ||
    currentUser?.role === "Admin" ||
    currentUser?.role === "Director";
  const tallyRows = tally ?? [];
  const nominationRows = nominations ?? [];
  const scrutineers = (users ?? []).filter((user) =>
    (election.scrutineerUserIds ?? []).includes(user._id),
  );
  const canNominate =
    isBetterAuthMode() &&
    !!currentUser?.memberId &&
    isWindowOpen(
      election.nominationsOpenAtISO ?? election.createdAtISO,
      election.nominationsCloseAtISO ?? election.closesAtISO,
    );

  useEffect(() => {
    if (!election) return;
    setAdminDraft((current: any) =>
      current && current.electionId === election._id
        ? current
        : {
            electionId: election._id,
            nominationsOpenAtISO: toLocalDateTime(
              election.nominationsOpenAtISO ?? election.opensAtISO,
            ),
            nominationsCloseAtISO: toLocalDateTime(
              election.nominationsCloseAtISO ?? election.closesAtISO,
            ),
            scrutineerUserIds: election.scrutineerUserIds ?? [],
            resultsSummary: election.resultsSummary ?? "",
            evidenceDocumentId: election.evidenceDocumentId ?? "",
          },
    );
  }, [election]);

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

  const saveNomination = async () => {
    await submitNomination({
      electionId: election._id,
      questionId: nominationDraft.questionId
        ? (nominationDraft.questionId as Id<"electionQuestions">)
        : undefined,
      nomineeName: nominationDraft.nomineeName,
      nomineeEmail: nominationDraft.nomineeEmail || undefined,
      statement: nominationDraft.statement || undefined,
      actingUserId,
    });
    toast.success("Nomination submitted");
    setNominationDraft({
      nomineeName: "",
      nomineeEmail: currentUser?.email ?? "",
      statement: "",
      questionId: "",
    });
  };

  const saveAdminSettings = async () => {
    if (!adminDraft) return;
    await updateSettings({
      electionId: election._id,
      nominationsOpenAtISO: adminDraft.nominationsOpenAtISO
        ? new Date(adminDraft.nominationsOpenAtISO).toISOString()
        : undefined,
      nominationsCloseAtISO: adminDraft.nominationsCloseAtISO
        ? new Date(adminDraft.nominationsCloseAtISO).toISOString()
        : undefined,
      scrutineerUserIds: adminDraft.scrutineerUserIds,
      resultsSummary: adminDraft.resultsSummary || undefined,
      evidenceDocumentId: adminDraft.evidenceDocumentId || undefined,
      actingUserId,
    });
    toast.success("Election settings saved");
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
        ).toLocaleString()} · ${electionBundle.ballotCount} ballot${electionBundle.ballotCount === 1 ? "" : "s"} recorded`}
        actions={
          canManage ? (
            <div className="row" style={{ gap: 8 }}>
              {election.status === "Open" && (
                <button
                  className="btn-action"
                  onClick={async () => {
                    await closeElection({
                      electionId: election._id,
                      actingUserId,
                    });
                    toast.info("Election closed");
                  }}
                >
                  <Lock size={12} /> Close election
                </button>
              )}
              {election.status === "Closed" && (
                <button
                  className="btn-action btn-action--primary"
                  onClick={async () => {
                    await tallyElection({
                      electionId: election._id,
                      resultsSummary: adminDraft?.resultsSummary || undefined,
                      evidenceDocumentId: adminDraft?.evidenceDocumentId || undefined,
                      actingUserId,
                    });
                    toast.success("Results published");
                  }}
                >
                  <CheckCircle2 size={12} /> Publish results
                </button>
              )}
            </div>
          ) : null
        }
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
              {!canVote && election.status === "Open" && (
                <div className="muted" style={{ fontSize: 13 }}>
                  {myEligibility
                    ? "You can review the ballot, but your vote is already recorded."
                    : "Voting is limited to confirmed members on the eligibility list."}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Nominations</h2>
              <span className="card__subtitle">
                {election.nominationsOpenAtISO
                  ? `${new Date(election.nominationsOpenAtISO).toLocaleString()} → ${new Date(
                      election.nominationsCloseAtISO ?? election.closesAtISO,
                    ).toLocaleString()}`
                  : "No nomination window configured"}
              </span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 12 }}>
              {canNominate && (
                <div className="panel" style={{ padding: 12, display: "grid", gap: 10 }}>
                  <Field label="Nominee name">
                    <input
                      className="input"
                      value={nominationDraft.nomineeName}
                      onChange={(e) =>
                        setNominationDraft({ ...nominationDraft, nomineeName: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      className="input"
                      value={nominationDraft.nomineeEmail}
                      onChange={(e) =>
                        setNominationDraft({ ...nominationDraft, nomineeEmail: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Ballot question">
                    <Select value={nominationDraft.questionId} onChange={value => setNominationDraft({
  ...nominationDraft,
  questionId: value
})} options={[{
  value: "",
  label: "Any ballot question"
}, ...electionBundle.questions.map((question: any) => ({
  value: question._id,
  label: question.title
}))]} className="input" />
                  </Field>
                  <Field label="Candidate statement">
                    <textarea
                      className="textarea"
                      rows={4}
                      value={nominationDraft.statement}
                      onChange={(e) =>
                        setNominationDraft({ ...nominationDraft, statement: e.target.value })
                      }
                    />
                  </Field>
                  <button className="btn btn--accent" onClick={saveNomination}>
                    Submit nomination
                  </button>
                </div>
              )}
              {!canNominate && (
                <div className="muted" style={{ fontSize: 13 }}>
                  Nominations are available only to confirmed members while the nomination
                  window is open.
                </div>
              )}
              {nominationRows.length > 0 ? (
                nominationRows.map((nomination: any) => (
                  <div key={nomination._id} className="panel" style={{ padding: 12 }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                      <strong>{nomination.nomineeName}</strong>
                      <Badge
                        tone={
                          nomination.status === "OnBallot"
                            ? "success"
                            : nomination.status === "Rejected"
                              ? "danger"
                              : "warn"
                        }
                      >
                        {nomination.status}
                      </Badge>
                    </div>
                    {nomination.statement && (
                      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                        {nomination.statement}
                      </div>
                    )}
                    {canManage && (
                      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        {nomination.status !== "Accepted" && nomination.status !== "OnBallot" && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              await reviewNomination({
                                id: nomination._id,
                                status: "Accepted",
                                actingUserId,
                              });
                              toast.success("Nomination accepted");
                            }}
                          >
                            Accept
                          </button>
                        )}
                        {nomination.status !== "Rejected" && nomination.status !== "OnBallot" && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              await reviewNomination({
                                id: nomination._id,
                                status: "Rejected",
                                actingUserId,
                              });
                              toast.info("Nomination rejected");
                            }}
                          >
                            Reject
                          </button>
                        )}
                        {nomination.status !== "OnBallot" && electionBundle.questions[0] && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              await publishNominationToBallot({
                                id: nomination._id,
                                questionId:
                                  (nomination.questionId as Id<"electionQuestions">) ??
                                  electionBundle.questions[0]._id,
                                actingUserId,
                              });
                              toast.success("Nomination added to ballot");
                            }}
                          >
                            Add to ballot
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="muted" style={{ fontSize: 13 }}>
                  No nominations yet.
                </div>
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
                label="Results visibility"
                value={
                  election.status === "Open" && !electionBundle.canSeeSensitive ? (
                    <Badge tone="warn">Hidden while open</Badge>
                  ) : (
                    <Badge tone="success">Visible</Badge>
                  )
                }
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

          {canManage && adminDraft && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Administration</h2>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 12 }}>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {scrutineers.length > 0 ? (
                    scrutineers.map((user) => <Badge key={user._id}>{user.displayName}</Badge>)
                  ) : (
                    <span className="muted">No scrutineers assigned.</span>
                  )}
                </div>
                <div className="row" style={{ gap: 12 }}>
                  <Field label="Nominations open">
                    <input
                      className="input"
                      type="datetime-local"
                      value={adminDraft.nominationsOpenAtISO}
                      onChange={(e) =>
                        setAdminDraft({ ...adminDraft, nominationsOpenAtISO: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Nominations close">
                    <input
                      className="input"
                      type="datetime-local"
                      value={adminDraft.nominationsCloseAtISO}
                      onChange={(e) =>
                        setAdminDraft({ ...adminDraft, nominationsCloseAtISO: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field label="Scrutineers">
                  <div style={{ display: "grid", gap: 6 }}>
                    {(users ?? []).map((user) => {
                      const checked = adminDraft.scrutineerUserIds.includes(user._id);
                      return (
                        <label key={user._id} className="checkbox">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setAdminDraft((current: any) => ({
                                ...current,
                                scrutineerUserIds: checked
                                  ? current.scrutineerUserIds.filter((id: string) => id !== user._id)
                                  : [...current.scrutineerUserIds, user._id],
                              }))
                            }
                          />
                          {user.displayName} <span className="muted">({user.role})</span>
                        </label>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Results summary">
                  <textarea
                    className="textarea"
                    rows={4}
                    value={adminDraft.resultsSummary}
                    onChange={(e) =>
                      setAdminDraft({ ...adminDraft, resultsSummary: e.target.value })
                    }
                  />
                </Field>
                <Field label="Evidence document">
                  <Select value={adminDraft.evidenceDocumentId} onChange={value => setAdminDraft({
  ...adminDraft,
  evidenceDocumentId: value
})} options={[{
  value: "",
  label: "No evidence document"
}, ...(documents ?? []).map(document => ({
  value: document._id,
  label: document.title
}))]} className="input" />
                </Field>
                <button className="btn btn--accent" onClick={saveAdminSettings}>
                  Save election settings
                </button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Tally</h2>
              <span className="card__subtitle">
                {electionBundle.ballotCount} anonymous ballot(s)
              </span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 12 }}>
              {tallyRows.length > 0 ? (
                tallyRows.map((question: any) => (
                  <div key={question.questionId}>
                    <strong>{question.title}</strong>
                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      {question.totals.map((total: any) => (
                        <Row key={total.id} label={total.label} value={`${total.votes} vote(s)`} />
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="muted" style={{ fontSize: 13 }}>
                  {election.status === "Open" && !electionBundle.canSeeSensitive
                    ? "Live counts stay hidden while voting is open."
                    : "No tally available yet."}
                </div>
              )}
              {election.resultsSummary && (
                <div className="muted" style={{ fontSize: 13 }}>
                  <strong>Published summary:</strong> {election.resultsSummary}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Audit log</h2>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 8 }}>
              {electionBundle.audit.length > 0 ? (
                electionBundle.audit.map((event: any) => (
                  <div key={event._id} className="muted" style={{ fontSize: 13 }}>
                    <strong>{event.actorName}</strong> {event.action}
                    {event.detail ? ` — ${event.detail}` : ""} ·{" "}
                    {new Date(event.createdAtISO).toLocaleString()}
                  </div>
                ))
              ) : (
                <div className="muted" style={{ fontSize: 13 }}>
                  <ShieldCheck size={12} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
                  Audit details are reserved for directors and admins.
                </div>
              )}
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

function toLocalDateTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 16);
}

function isWindowOpen(startISO?: string | null, endISO?: string | null) {
  const now = Date.now();
  const starts = startISO ? new Date(startISO).getTime() : Number.NEGATIVE_INFINITY;
  const ends = endISO ? new Date(endISO).getTime() : Number.POSITIVE_INFINITY;
  return now >= starts && now <= ends;
}
