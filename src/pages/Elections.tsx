import { formatDate } from "../lib/format";
import { useConfirm } from "../components/Modal";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useBylawRules } from "../hooks/useBylawRules";
import { InfoPopover } from "../components/InfoPopover";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { DateTimeInput } from "../components/DateTimeInput";
import { AlertTriangle, Info, Vote, Plus, Users, CheckCircle2, Trash2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { isAuthenticatedAuthMode } from "../lib/authMode";
import { toDateTimeLocalValue } from "../lib/format";
import { normalizeElectionWindow, validateElectionQuestion } from "../../shared/electionValidation";

type ElectionCreateForm = {
  title: string;
  description: string;
  opensAtISO: string;
  closesAtISO: string;
  nominationsOpenAtISO: string;
  nominationsCloseAtISO: string;
  scrutineerUserIds: string[];
  questionTitle: string;
  optionLabels: string[];
};

const EMPTY_OPTION_LABELS = ["", ""];

export function ElectionsPage() {
  const navigate = useNavigate();
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canManage = loaded && can("elections:write");
  const canTally = loaded && can("elections:tally");
  const actingUserId = useCurrentUserId() ?? undefined;
  const elections = useQuery(
    api.elections.list,
    society ? { societyId: society._id } : "skip",
  );
  const users = useQuery(
    api.users.list,
    society && loaded && can("users:read") ? { societyId: society._id } : "skip",
  );
  const myElections = useQuery(
    api.elections.listMine,
    society ? { societyId: society._id, userId: actingUserId } : "skip",
  );
  const { rules } = useBylawRules();
  const create = useMutation(api.elections.create);
  const snapshotEligibleVoters = useMutation(api.elections.snapshotEligibleVoters);
  const closeElection = useMutation(api.elections.close);
  const tallyElection = useMutation(api.elections.tallyElection);
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ElectionCreateForm | null>(null);
  const [saving, setSaving] = useState(false);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openCreate = () => {
    const now = new Date();
    const closes = new Date(now.getTime() + 7 * 86_400_000);
    setForm({
      title: "",
      description: "",
      opensAtISO: toDateTimeLocalValue(now),
      closesAtISO: toDateTimeLocalValue(closes),
      nominationsOpenAtISO: toDateTimeLocalValue(now),
      nominationsCloseAtISO: toDateTimeLocalValue(new Date(now.getTime() + 3 * 86_400_000)),
      scrutineerUserIds: [],
      questionTitle: "Election of directors",
      optionLabels: [...EMPTY_OPTION_LABELS],
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form || !canManage || saving) return;
    setSaving(true);
    try {
      if (!form.title.trim()) throw new Error("Enter an election title.");
      normalizeElectionWindow(form.opensAtISO, form.closesAtISO, "Voting");
      const initialQuestion = {
        title: form.questionTitle.trim(),
        maxSelections: 1,
        options: form.optionLabels.map((label) => label.trim()).filter(Boolean).map((label, index) => ({ id: `candidate-${index + 1}`, label })),
      };
      validateElectionQuestion(initialQuestion);
      const electionId = await create({
        societyId: society._id,
        title: form.title,
        description: form.description || undefined,
        opensAtISO: new Date(form.opensAtISO).toISOString(),
        closesAtISO: new Date(form.closesAtISO).toISOString(),
        nominationsOpenAtISO: form.nominationsOpenAtISO
          ? new Date(form.nominationsOpenAtISO).toISOString()
          : undefined,
        nominationsCloseAtISO: form.nominationsCloseAtISO
          ? new Date(form.nominationsCloseAtISO).toISOString()
          : undefined,
        scrutineerUserIds: form.scrutineerUserIds,
        initialQuestion,
      });
      toast.success("Election created");
      setOpen(false);
      navigate(`/app/elections/${electionId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the election. Your draft is retained.");
    } finally {
      setSaving(false);
    }
  };

  const updateOptionLabel = (index: number, label: string) => {
    setForm((current) => {
      if (!current) return current;
      const optionLabels = [...current.optionLabels];
      optionLabels[index] = label;
      return { ...current, optionLabels };
    });
  };

  const addOptionField = () => {
    setForm((current) =>
      current ? { ...current, optionLabels: [...current.optionLabels, ""] } : current,
    );
  };

  const removeOptionField = (index: number) => {
    setForm((current) => {
      if (!current) return current;
      const optionLabels = current.optionLabels.filter((_, optionIndex) => optionIndex !== index);
      return {
        ...current,
        optionLabels: optionLabels.length > 0 ? optionLabels : [""],
      };
    });
  };

  return (
    <div className="page">
      <PageHeader
        title="Elections"
        icon={<Vote size={16} />}
        iconColor="purple"
        subtitle="Member elections with anonymous ballots."
        info={<p>Verified member eligibility with anonymous ballot storage. Voter identity stays in the eligibility ledger; ballots are stored separately.</p>}
        actions={
          canManage ? (
            <button className="btn-action btn-action--primary" onClick={openCreate}>
              <Plus size={12} /> New election
            </button>
          ) : null
        }
      />

      {!isAuthenticatedAuthMode() && (
        <div className="callout callout--info">
          <Info size={16} />
          <div className="row" style={{ gap: 6, flexWrap: "nowrap", alignItems: "center" }}>
            <span><strong>No-auth mode:</strong> member ballots are turned off.</span>
            <InfoPopover label="About no-auth mode">
              <p>Real anonymous member voting requires authenticated member accounts. You can still design and administer elections here, but the member ballot flow stays disabled until authentication is enabled.</p>
            </InfoPopover>
          </div>
        </div>
      )}

      {rules && !rules.allowElectronicVoting && (
        <div className="callout callout--warn">
          <AlertTriangle size={16} />
          <div className="row" style={{ gap: 6, flexWrap: "nowrap", alignItems: "center" }}>
            <span><strong>Bylaw restriction:</strong> the bylaws don't allow electronic voting.</span>
            <InfoPopover label="About the bylaw restriction">
              <p>The active bylaw rule set currently disallows electronic voting. You can still prepare elections here, but opening them for remote ballots may not match the society's bylaws.</p>
            </InfoPopover>
          </div>
        </div>
      )}

      {myElections && myElections.length > 0 && (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">My ballots</h2>
            <span className="card__subtitle">Verified member view</span>
          </div>
          <div className="card__body" style={{ display: "grid", gap: 10 }}>
            {myElections.map((row: any) => (
              <Link
                key={row.election._id}
                to={`/app/elections/${row.election._id}`}
                className="panel"
                style={{ padding: 12, borderRadius: 8 }}
              >
                <div className="row">
                  <strong>{row.election.title}</strong>
                  <Badge tone={row.eligibility?.status === "Voted" ? "success" : "info"}>
                    {row.eligibility?.status ?? "Eligible"}
                  </Badge>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Opens {formatDate(row.election.opensAtISO)} · closes{" "}
                  {formatDate(row.election.closesAtISO)}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">All elections</h2>
          <span className="card__subtitle">{elections?.length ?? 0} total</span>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table className="table elections-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Election</th>
              <th>Status</th>
              <th>Opens</th>
              <th>Closes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(elections ?? []).map((election: any) => (
              <tr key={election._id}>
                <td>
                  <strong>{election.title}</strong>
                  {election.description && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {election.description}
                    </div>
                  )}
                </td>
                <td>
                  <Badge
                    tone={
                      election.status === "Closed" || election.status === "Tallied"
                        ? "warn"
                        : election.status === "Open"
                        ? "success"
                        : "info"
                    }
                  >
                    {election.status}
                  </Badge>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {formatDate(election.opensAtISO)}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {formatDate(election.closesAtISO)}
                </td>
                <td>
                  <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <Link to={`/app/elections/${election._id}`} className="btn btn--ghost btn--sm">
                      View
                    </Link>
                    {canManage && (
                      <>
                        {election.status === "Draft" && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              const result = await snapshotEligibleVoters({
                                electionId: election._id,
                              });
                              toast.success(
                                `Snapshotted ${result.eligibleCount} eligible voter(s) and opened voting`,
                              );
                            }}
                          >
                            <Users size={12} /> Snapshot + open
                          </button>
                        )}
                        {election.status === "Open" && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              const early = Date.parse(election.closesAtISO) > Date.now();
                              const ok = await confirm({
                                title: `Close voting on "${election.title}"?`,
                                message: `${early ? `Voting is scheduled to stay open until ${formatDate(election.closesAtISO)}. ` : ""}Closing stops all further ballots and cannot be reopened.`,
                                confirmLabel: early ? "Close early" : "Close voting",
                                tone: early ? "danger" : "warn",
                              });
                              if (!ok) return;
                              await closeElection({
                                electionId: election._id,
                              });
                              toast.info("Election closed");
                            }}
                          >
                            <CheckCircle2 size={12} /> Close
                          </button>
                        )}
                        {canTally && election.status === "Closed" && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              const ok = await confirm({
                                title: `Publish results for "${election.title}"?`,
                                message: "The ballots will be tallied and the results recorded as final. Open the election to review the ballot count first.",
                                confirmLabel: "Publish results",
                                tone: "warn",
                              });
                              if (!ok) return;
                              await tallyElection({
                                electionId: election._id,
                              });
                              toast.success("Results published");
                            }}
                          >
                            <CheckCircle2 size={12} /> Publish results
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {(elections ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No elections yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <Drawer
        open={open}
        onClose={() => { if (!saving) setOpen(false); }}
        title="New election"
        footer={
          <>
            <button className="btn" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save} disabled={!canManage || saving || !form?.title.trim() || !form.questionTitle.trim() || !form.optionLabels.some((label) => label.trim())}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {form && (
          <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <Field label="Election title">
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <MarkdownEditor
                rows={4}
                value={form.description}
                onChange={(markdown) => setForm({ ...form, description: markdown })}
              />
            </Field>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <Field label="Opens">
                <DateTimeInput
                  value={form.opensAtISO}
                  onChange={(value) => setForm({ ...form, opensAtISO: value })}
                />
              </Field>
              <Field label="Closes">
                <DateTimeInput
                  value={form.closesAtISO}
                  onChange={(value) => setForm({ ...form, closesAtISO: value })}
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <Field label="Nominations open">
                <DateTimeInput
                  value={form.nominationsOpenAtISO}
                  onChange={(value) => setForm({ ...form, nominationsOpenAtISO: value })}
                />
              </Field>
              <Field label="Nominations close">
                <DateTimeInput
                  value={form.nominationsCloseAtISO}
                  onChange={(value) => setForm({ ...form, nominationsCloseAtISO: value })}
                />
              </Field>
            </div>
            <Field label="Scrutineers">
              <div style={{ display: "grid", gap: 6 }}>
                {(users ?? []).map((user) => {
                  const checked = form.scrutineerUserIds.includes(user._id);
                  return (
                    <label key={user._id} className="checkbox">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setForm((current: any) => ({
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
            <Field label="Ballot question">
              <input
                className="input"
                value={form.questionTitle}
                onChange={(e) => setForm({ ...form, questionTitle: e.target.value })}
              />
            </Field>
            <Field
              label="Candidates or options"
              hint="Add each ballot choice as its own option. Blank rows are ignored."
            >
              <div style={{ display: "grid", gap: 8 }}>
                {form.optionLabels.map((label, index) => (
                  <div key={index} className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input
                      className="input"
                      value={label}
                      placeholder={`Option ${index + 1}`}
                      onChange={(e) => updateOptionLabel(index, e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => removeOptionField(index)}
                      aria-label={`Remove option ${index + 1}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <div>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={addOptionField}>
                    <Plus size={12} /> Add option
                  </button>
                </div>
              </div>
            </Field>
          </fieldset>
        )}
      </Drawer>
    </div>
  );
}
