import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { useRecordQuery } from "../hooks/useRecordQuery";
import { RecordNotFound } from "../components/RecordNotFound";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useCurrentUser, useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { Select } from "../components/Select";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { DateTimeInput } from "../components/DateTimeInput";
import { InfoPopover } from "../components/InfoPopover";
import { Vote, ArrowLeft, ShieldCheck, CheckCircle2, Lock, Plus, Users } from "lucide-react";
import { useToast } from "../components/Toast";
import { isAuthenticatedAuthMode } from "../lib/authMode";
import { formatDate, formatDateTime, toDateTimeLocalValue } from "../lib/format";
import { useConfirm } from "../components/Modal";
import { validateElectionQuestion } from "../../shared/electionValidation";

/** Matches the 12-hour clock of the nomination window pickers ("4:00 PM"). */
const NOMINATION_TIME_FORMAT = "MMM d, yyyy · h:mm a";

export function ElectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const currentUser = useCurrentUser();
  const { loaded, can } = usePermissions();
  const canManage = loaded && can("elections:write");
  const canPublishResults = canManage && can("elections:tally");
  const actingUserId = useCurrentUserId() ?? undefined;
  // A missing or foreign id reads as null and shows the not-found state; the
  // tally and nominations wait until the election exists (FF-2).
  const electionBundle = useRecordQuery<any>(
    api.elections.get,
    id
      ? { id: id as Id<"elections"> }
      : "skip",
  );
  const electionId = electionBundle?.election?._id as Id<"elections"> | undefined;
  const tally = useQuery(
    api.elections.tally,
    electionId ? { electionId } : "skip",
  );
  const nominations = useQuery(
    api.elections.listNominations,
    electionId ? { electionId } : "skip",
  );
  const users = useQuery(
    api.users.list,
    electionBundle?.election && loaded && can("users:read")
      ? { societyId: electionBundle.election.societyId }
      : "skip",
  );
  const documents = useQuery(
    api.documents.list,
    electionBundle?.election && loaded && can("documents:read") && canManage
      ? { societyId: electionBundle.election.societyId }
      : "skip",
  );
  const castBallot = useMutation(api.elections.castBallot);
  const closeElection = usePermissionedMutation(api.elections.close, canManage);
  const tallyElection = usePermissionedMutation(api.elections.tallyElection, canPublishResults);
  const submitNomination = useMutation(api.elections.submitNomination);
  const reviewNomination = usePermissionedMutation(api.elections.reviewNomination, canManage);
  const publishNominationToBallot = usePermissionedMutation(api.elections.publishNominationToBallot, canManage);
  const updateSettings = usePermissionedMutation(api.elections.updateSettings, canManage);
  const addQuestion = usePermissionedMutation(api.elections.addQuestion, canManage);
  const removeQuestion = usePermissionedMutation(api.elections.removeQuestion, canManage);
  const snapshotEligibleVoters = usePermissionedMutation(api.elections.snapshotEligibleVoters, canManage);
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [nominationDraft, setNominationDraft] = useState({
    nomineeName: "",
    nomineeEmail: currentUser?.email ?? "",
    statement: "",
    questionId: "",
  });
  const [adminDraft, setAdminDraft] = useState<any | null>(null);
  const [questionDraft, setQuestionDraft] = useState({ title: "", options: "", maxSelections: 1 });
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [openingElection, setOpeningElection] = useState(false);
  const [participantSaving, setParticipantSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const election = electionBundle?.election;
  const myEligibility = useMemo(() => {
    if (!currentUser?.memberId || !electionBundle?.eligible) return null;
    return (
      electionBundle.eligible.find(
        (row: any) => row.memberId === currentUser.memberId,
      ) ?? null
    );
  }, [currentUser?.memberId, electionBundle?.eligible]);

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

  if (electionBundle === undefined) return <PageLoading />;
  if (electionBundle === null || !election) return <RecordNotFound recordLabel="Election" backTo="/app/elections" backLabel="All elections" />;

  const canVote =
    isAuthenticatedAuthMode() &&
    election.status === "Open" &&
    isWindowOpen(election.opensAtISO, election.closesAtISO) &&
    !!currentUser?.memberId &&
    myEligibility &&
    myEligibility.status !== "Voted";
  // Explain exactly why this viewer cannot vote (G-16: everyone who could not
  // vote was told their vote was "already recorded").
  const votingUnavailableReason = !isAuthenticatedAuthMode()
    ? "Ballots can only be cast by signed-in members. This workspace is not using member sign-in, so you can review the ballot but not vote here."
    : !isWindowOpen(election.opensAtISO, election.closesAtISO)
      ? `Voting is open from ${formatDateTime(election.opensAtISO)} to ${formatDateTime(election.closesAtISO)}.`
      : !currentUser?.memberId
        ? "Your user account is not linked to a member record, so you cannot vote."
        : !myEligibility
          ? "Voting is limited to confirmed members on the eligibility list."
          : myEligibility.status === "Voted"
            ? "You can review the ballot, but your vote is already recorded."
            : "You cannot vote in this election.";
  const tallyRows = tally ?? [];
  const nominationRows = nominations ?? [];
  const canNominate =
    isAuthenticatedAuthMode() &&
    ["Draft", "Open"].includes(election.status) &&
    !!currentUser?.memberId &&
    isWindowOpen(
      election.nominationsOpenAtISO ?? election.createdAtISO,
      election.nominationsCloseAtISO ?? election.closesAtISO,
    );

  const saveBallot = async () => {
    if (!canVote || participantSaving) return;
    setParticipantSaving(true);
    try {
      await castBallot({
      electionId: election._id,
      choices: electionBundle.questions.map((question: any) => ({
        questionId: question._id,
        optionIds: selected[question._id] ?? [],
      })),
      });
      toast.success("Ballot submitted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit the ballot. Your selections are retained.");
    } finally { setParticipantSaving(false); }
  };

  const saveNomination = async () => {
    if (!canNominate || participantSaving || !nominationDraft.nomineeName.trim()) return;
    setParticipantSaving(true);
    try {
      await submitNomination({
      electionId: election._id,
      questionId: nominationDraft.questionId
        ? (nominationDraft.questionId as Id<"electionQuestions">)
        : undefined,
      nomineeName: nominationDraft.nomineeName,
      nomineeEmail: nominationDraft.nomineeEmail || undefined,
      statement: nominationDraft.statement || undefined,
      });
      toast.success("Nomination submitted");
      setNominationDraft({
      nomineeName: "",
      nomineeEmail: currentUser?.email ?? "",
      statement: "",
      questionId: "",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit the nomination. Your draft is retained.");
    } finally { setParticipantSaving(false); }
  };

  const saveAdminSettings = async () => {
    if (!canManage || !adminDraft || settingsSaving) return;
    setSettingsSaving(true);
    try {
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
      });
      toast.success("Election settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save election settings. Your draft is retained.");
    } finally { setSettingsSaving(false); }
  };

  const saveQuestion = async () => {
    if (!canManage || election.status !== "Draft" || savingQuestion) return;
    setSavingQuestion(true);
    try {
      const question = {
        title: questionDraft.title.trim(),
        maxSelections: questionDraft.maxSelections,
        options: questionDraft.options.split("\n").map((label) => label.trim()).filter(Boolean).map((label, index) => ({ id: `option-${index + 1}`, label })),
      };
      validateElectionQuestion(question);
      await addQuestion({ electionId: election._id, ...question });
      setQuestionDraft({ title: "", options: "", maxSelections: 1 });
      toast.success("Ballot question added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the ballot question. Your draft is retained.");
    } finally { setSavingQuestion(false); }
  };

  const openElection = async () => {
    if (!canManage || election.status !== "Draft" || openingElection) return;
    setOpeningElection(true);
    try {
      const result = await snapshotEligibleVoters({ electionId: election._id });
      toast.success(`Snapshotted ${result.eligibleCount} eligible voter(s) and opened voting`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the election.");
    } finally { setOpeningElection(false); }
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
        subtitle={`${formatDateTime(election.opensAtISO)} → ${formatDateTime(election.closesAtISO)} · ${electionBundle.ballotCount} ballot${electionBundle.ballotCount === 1 ? "" : "s"} recorded`}
        actions={
          canManage ? (
            <div className="row" style={{ gap: 8 }}>
              {election.status === "Open" && (
                <button
                  className="btn-action"
                  onClick={async () => {
                    const early = Date.parse(election.closesAtISO) > Date.now();
                    const ok = await confirm({
                      title: "Close voting?",
                      message: `${early ? `Voting is scheduled to stay open until ${formatDateTime(election.closesAtISO)}. ` : ""}Closing stops all further ballots; ${electionBundle.ballotCount} of ${electionBundle.eligible?.length ?? "the eligible"} voters have voted. This cannot be reopened.`,
                      confirmLabel: early ? "Close early" : "Close voting",
                      tone: early ? "danger" : "warn",
                    });
                    if (!ok) return;
                    try {
                      await closeElection({ electionId: election._id });
                      toast.info("Election closed");
                    } catch (error) {
                      toast.error("Could not close the election", error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  <Lock size={12} /> Close election
                </button>
              )}
              {canPublishResults && election.status === "Closed" && (
                <button
                  className="btn-action btn-action--primary"
                  onClick={async () => {
                    const ballots = electionBundle.ballotCount ?? 0;
                    const ok = await confirm({
                      title: ballots === 0 ? "Publish results with no ballots?" : "Publish results?",
                      message: ballots === 0
                        ? "No ballots were recorded, so every tally is zero. Publishing records a final result that no one voted on. Check quorum and whether the vote should be re-run before publishing."
                        : `${ballots} ballot${ballots === 1 ? "" : "s"} will be tallied and the results recorded as final.`,
                      confirmLabel: "Publish results",
                      tone: ballots === 0 ? "danger" : "warn",
                    });
                    if (!ok) return;
                    try {
                      await tallyElection({
                        electionId: election._id,
                        resultsSummary: adminDraft?.resultsSummary || undefined,
                        evidenceDocumentId: adminDraft?.evidenceDocumentId || undefined,
                      });
                      toast.success("Results published");
                    } catch (error) {
                      toast.error("Could not publish results", error instanceof Error ? error.message : String(error));
                    }
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
              {!isAuthenticatedAuthMode() && (
                <div className="muted">
                  Real anonymous member voting is disabled in no-auth mode.
                </div>
              )}
              {electionBundle.questions.length === 0 && <p className="muted">No ballot questions yet. A director or administrator must add a question before opening voting.</p>}
              {electionBundle.questions.map((question: any) => (
                <div key={question._id}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                    <strong>{question.title}</strong>
                    {canManage && election.status === "Draft" && (
                      <button
                        className="btn btn--ghost btn--sm"
                        aria-label={`Remove ballot question ${question.title}`}
                        onClick={async () => {
                          const ok = await confirm({
                            title: "Remove ballot question?",
                            message: `"${question.title}" and its ${question.options?.length ?? 0} option(s) will be removed from this draft ballot.`,
                            confirmLabel: "Remove question",
                            tone: "danger",
                          });
                          if (!ok) return;
                          try {
                            await removeQuestion({ questionId: question._id });
                            toast.success("Ballot question removed");
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : "Could not remove the question.");
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
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
                        <label
                          key={option.id}
                          className="checkbox"
                          // Read-only ballots look read-only, not like live choices.
                          style={!canVote ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                          aria-disabled={!canVote || undefined}
                        >
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
                            disabled={!canVote || participantSaving}
                          />
                          {option.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              {canManage && election.status === "Draft" && (
                <fieldset disabled={savingQuestion || openingElection} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 10 }}>
                  <Field label="New ballot question"><input className="input" value={questionDraft.title} onChange={(event) => setQuestionDraft({ ...questionDraft, title: event.target.value })} /></Field>
                  <Field label="Ballot options" hint="One candidate or choice per line."><textarea className="input" rows={4} value={questionDraft.options} onChange={(event) => setQuestionDraft({ ...questionDraft, options: event.target.value })} /></Field>
                  <Field label="Maximum selections"><input className="input" type="number" min={1} step={1} value={questionDraft.maxSelections} onChange={(event) => setQuestionDraft({ ...questionDraft, maxSelections: Number(event.target.value) })} /></Field>
                  <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                    <button className="btn" onClick={saveQuestion} disabled={!questionDraft.title.trim() || !questionDraft.options.trim()}><Plus size={12} /> {savingQuestion ? "Adding…" : "Add ballot question"}</button>
                    <button className="btn btn--accent" onClick={openElection} disabled={electionBundle.questions.length === 0}><Users size={12} /> {openingElection ? "Opening…" : "Snapshot + open"}</button>
                  </div>
                  <p className="muted">Finish the questions and accepted nominations before opening. The ballot and eligibility list are frozen when voting opens.</p>
                </fieldset>
              )}

              {canVote && (
                <button className="btn btn--accent" onClick={saveBallot} disabled={participantSaving || !electionBundle.questions.length || electionBundle.questions.some((question: any) => !(selected[question._id]?.length))}>
                  Submit anonymous ballot
                </button>
              )}
              {!canVote && election.status === "Open" && (
                <div className="muted" style={{ fontSize: 13 }}>
                  {votingUnavailableReason}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Nominations</h2>
              <InfoPopover label="About nominations">
                <p>Nominations are available only to confirmed members while the nomination window is open.</p>
              </InfoPopover>
              <span className="card__subtitle">
                {election.nominationsOpenAtISO
                  ? `${formatDate(election.nominationsOpenAtISO, NOMINATION_TIME_FORMAT)} → ${formatDate(election.nominationsCloseAtISO ?? election.closesAtISO, NOMINATION_TIME_FORMAT)}`
                  : "No nomination window configured"}
              </span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 12 }}>
              {canNominate && (
                <fieldset disabled={participantSaving} className="panel" style={{ padding: 12, margin: 0, minWidth: 0, display: "grid", gap: 10 }}>
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
                    <Select
                      value={nominationDraft.questionId}
                      onChange={(value) =>
                        setNominationDraft({ ...nominationDraft, questionId: value })
                      }
                      options={[
                        { value: "", label: "Any ballot question" },
                        ...electionBundle.questions.map((question: any) => ({
                          value: question._id,
                          label: question.title,
                        })),
                      ]}
                    />
                  </Field>
                  <Field label="Candidate statement">
                    <MarkdownEditor
                      rows={4}
                      value={nominationDraft.statement}
                      onChange={(markdown) =>
                        setNominationDraft({ ...nominationDraft, statement: markdown })
                      }
                    />
                  </Field>
                  <button className="btn btn--accent" onClick={saveNomination} disabled={participantSaving || !nominationDraft.nomineeName.trim()}>
                    Submit nomination
                  </button>
                </fieldset>
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
                              });
                              toast.info("Nomination rejected");
                            }}
                          >
                            Reject
                          </button>
                        )}
                        {election.status === "Draft" && nomination.status === "Accepted" && electionBundle.questions[0] && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              await publishNominationToBallot({
                                id: nomination._id,
                                questionId:
                                  (nomination.questionId as Id<"electionQuestions">) ??
                                  electionBundle.questions[0]._id,
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
              <InfoPopover label="About eligibility">
                <p>Eligibility is verified against the member register. The ballot itself is stored without a member identifier.</p>
              </InfoPopover>
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
            </div>
          </div>

          {canManage && adminDraft && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Administration</h2>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 12 }}>
                <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <Field label="Nominations open">
                    <DateTimeInput
                      clock={12}
                      value={adminDraft.nominationsOpenAtISO}
                      onChange={(value) =>
                        setAdminDraft({ ...adminDraft, nominationsOpenAtISO: value })
                      }
                    />
                  </Field>
                  <Field label="Nominations close">
                    <DateTimeInput
                      clock={12}
                      value={adminDraft.nominationsCloseAtISO}
                      onChange={(value) =>
                        setAdminDraft({ ...adminDraft, nominationsCloseAtISO: value })
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
                  <MarkdownEditor
                    rows={4}
                    value={adminDraft.resultsSummary}
                    onChange={(markdown) =>
                      setAdminDraft({ ...adminDraft, resultsSummary: markdown })
                    }
                  />
                </Field>
                <Field label="Evidence document">
                  <Select
                    value={adminDraft.evidenceDocumentId}
                    onChange={(value) =>
                      setAdminDraft({ ...adminDraft, evidenceDocumentId: value })
                    }
                    options={[
                      { value: "", label: "No evidence document" },
                      ...(documents ?? []).map((document) => ({
                        value: document._id,
                        label: document.title,
                      })),
                    ]}
                  />
                </Field>
                <button className="btn btn--accent" onClick={saveAdminSettings} disabled={settingsSaving}>
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
                    {formatDateTime(event.createdAtISO)}
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
  return toDateTimeLocalValue(new Date(value));
}

function isWindowOpen(startISO?: string | null, endISO?: string | null) {
  const now = Date.now();
  const starts = startISO ? new Date(startISO).getTime() : Number.NEGATIVE_INFINITY;
  const ends = endISO ? new Date(endISO).getTime() : Number.POSITIVE_INFINITY;
  return now >= starts && now <= ends;
}
