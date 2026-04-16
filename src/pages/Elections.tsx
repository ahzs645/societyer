import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUser, useCurrentUserId } from "../hooks/useCurrentUser";
import { useBylawRules } from "../hooks/useBylawRules";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Vote, Plus, Users, CheckCircle2, Trash2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { isBetterAuthMode } from "../lib/authMode";

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
  const society = useSociety();
  const currentUser = useCurrentUser();
  const actingUserId = useCurrentUserId() ?? undefined;
  const elections = useQuery(
    api.elections.list,
    society ? { societyId: society._id } : "skip",
  );
  const users = useQuery(
    api.users.list,
    society ? { societyId: society._id } : "skip",
  );
  const myElections = useQuery(
    api.elections.listMine,
    society ? { societyId: society._id, userId: actingUserId } : "skip",
  );
  const { rules } = useBylawRules();
  const create = useMutation(api.elections.create);
  const addQuestion = useMutation(api.elections.addQuestion);
  const snapshotEligibleVoters = useMutation(api.elections.snapshotEligibleVoters);
  const closeElection = useMutation(api.elections.close);
  const tallyElection = useMutation(api.elections.tallyElection);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ElectionCreateForm | null>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const canManage =
    currentUser?.role === "Owner" ||
    currentUser?.role === "Admin" ||
    currentUser?.role === "Director";

  const openCreate = () => {
    const now = new Date();
    const closes = new Date(now.getTime() + 7 * 86_400_000);
    setForm({
      title: "",
      description: "",
      opensAtISO: now.toISOString().slice(0, 16),
      closesAtISO: closes.toISOString().slice(0, 16),
      nominationsOpenAtISO: now.toISOString().slice(0, 16),
      nominationsCloseAtISO: new Date(now.getTime() + 3 * 86_400_000)
        .toISOString()
        .slice(0, 16),
      scrutineerUserIds: [],
      questionTitle: "Election of directors",
      optionLabels: [...EMPTY_OPTION_LABELS],
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form) return;

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
      actingUserId,
    });
    const options = form.optionLabels
      .map((label) => label.trim())
      .filter(Boolean)
      .map((label, index) => ({
        id: `candidate-${index + 1}`,
        label,
      }));
    if (options.length > 0) {
      await addQuestion({
        electionId,
        title: form.questionTitle || "Election",
        maxSelections: 1,
        options,
        actingUserId,
      });
    }
    toast.success("Election created");
    setOpen(false);
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
        subtitle="Verified member eligibility with anonymous ballot storage. Voter identity stays in the eligibility ledger; ballots are stored separately."
        actions={
          canManage ? (
            <button className="btn-action btn-action--primary" onClick={openCreate}>
              <Plus size={12} /> New election
            </button>
          ) : null
        }
      />

      {!isBetterAuthMode() && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__body">
            Real anonymous member voting requires authenticated member accounts.
            You can still design and administer elections here, but the member
            ballot flow stays disabled until authentication is enabled.
          </div>
        </div>
      )}

      {rules && !rules.allowElectronicVoting && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__body">
            The active bylaw rule set currently disallows electronic voting. You can
            still prepare elections here, but opening them for remote ballots may not
            match the society's bylaws.
          </div>
        </div>
      )}

      {myElections && myElections.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
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
                  Opens {new Date(row.election.opensAtISO).toLocaleString()} · closes{" "}
                  {new Date(row.election.closesAtISO).toLocaleString()}
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
        <table className="table">
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
                <td className="mono">
                  {new Date(election.opensAtISO).toLocaleDateString()}
                </td>
                <td className="mono">
                  {new Date(election.closesAtISO).toLocaleDateString()}
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
                                actingUserId,
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
                              await closeElection({
                                electionId: election._id,
                                actingUserId,
                              });
                              toast.info("Election closed");
                            }}
                          >
                            <CheckCircle2 size={12} /> Close
                          </button>
                        )}
                        {election.status === "Closed" && (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              await tallyElection({
                                electionId: election._id,
                                actingUserId,
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

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New election"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save}>
              Save
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Election title">
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="textarea"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Opens">
                <input
                  className="input"
                  type="datetime-local"
                  value={form.opensAtISO}
                  onChange={(e) => setForm({ ...form, opensAtISO: e.target.value })}
                />
              </Field>
              <Field label="Closes">
                <input
                  className="input"
                  type="datetime-local"
                  value={form.closesAtISO}
                  onChange={(e) => setForm({ ...form, closesAtISO: e.target.value })}
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Nominations open">
                <input
                  className="input"
                  type="datetime-local"
                  value={form.nominationsOpenAtISO}
                  onChange={(e) => setForm({ ...form, nominationsOpenAtISO: e.target.value })}
                />
              </Field>
              <Field label="Nominations close">
                <input
                  className="input"
                  type="datetime-local"
                  value={form.nominationsCloseAtISO}
                  onChange={(e) => setForm({ ...form, nominationsCloseAtISO: e.target.value })}
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
          </div>
        )}
      </Drawer>
    </div>
  );
}
