import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUser, useCurrentUserId } from "../hooks/useCurrentUser";
import { useBylawRules } from "../hooks/useBylawRules";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Vote, Plus, Users, CheckCircle2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { isBetterAuthMode } from "../lib/authMode";

export function ElectionsPage() {
  const society = useSociety();
  const currentUser = useCurrentUser();
  const actingUserId = useCurrentUserId() ?? undefined;
  const elections = useQuery(
    api.elections.list,
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
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

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
      questionTitle: "Election of directors",
      candidateLines: "",
    });
    setOpen(true);
  };

  const save = async () => {
    const electionId = await create({
      societyId: society._id,
      title: form.title,
      description: form.description || undefined,
      opensAtISO: new Date(form.opensAtISO).toISOString(),
      closesAtISO: new Date(form.closesAtISO).toISOString(),
      actingUserId,
    });
    const options = form.candidateLines
      .split("\n")
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((label: string, index: number) => ({
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
            `AUTH_MODE=better-auth` is required for real anonymous member voting.
            In no-auth mode you can still design and administer elections, but the
            member voting flow stays disabled.
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
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={async () => {
                            const result = await snapshotEligibleVoters({
                              electionId: election._id,
                              actingUserId,
                            });
                            toast.success(
                              `Snapshotted ${result.eligibleCount} eligible voter(s)`,
                            );
                          }}
                        >
                          <Users size={12} /> Snapshot
                        </button>
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
            <Field label="Ballot question">
              <input
                className="input"
                value={form.questionTitle}
                onChange={(e) => setForm({ ...form, questionTitle: e.target.value })}
              />
            </Field>
            <Field label="Candidates or options" hint="One option per line">
              <textarea
                className="textarea"
                value={form.candidateLines}
                onChange={(e) => setForm({ ...form, candidateLines: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}
