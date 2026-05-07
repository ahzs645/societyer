import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Bot, History, Play, ShieldCheck } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt } from "./_helpers";
import { Badge, Field, SettingsShell } from "../components/ui";
import { useToast } from "../components/Toast";

type AgentDefinition = {
  key: string;
  name: string;
  summary: string;
  scope: string;
  allowedActions: string[];
  allowedTools: string[];
  requiredInputHints: string[];
  workflowModes?: string[];
  outputContract?: string[];
};

export function AiAgentsPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const agents = useQuery(api.aiAgents.listDefinitions, {}) as AgentDefinition[] | undefined;
  const runs = useQuery(
    api.aiAgents.listRuns,
    society ? { societyId: society._id, limit: 20 } : "skip",
  ) as any[] | undefined;
  const runAgent = useMutation(api.aiAgents.runAgent);
  const toast = useToast();

  const [selectedKey, setSelectedKey] = useState("compliance_analyst");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<any | null>(null);

  const agentList = agents ?? [];
  const selectedAgent = useMemo(
    () => agentList.find((agent) => agent.key === selectedKey) ?? agentList[0],
    [agentList, selectedKey],
  );

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const startRun = async () => {
    if (!selectedAgent || !input.trim()) return;
    setBusy(true);
    try {
      const result = await runAgent({
        societyId: society._id,
        agentKey: selectedAgent.key,
        input: input.trim(),
        actingUserId,
      });
      setLastResult(result);
      setInput("");
      toast.success(`${selectedAgent.name} run logged`);
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't run AI workspace tool");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--wide">
      <SettingsShell
        title="AI agents"
        icon={<Bot size={16} />}
        iconColor="purple"
        description="Bounded workspace tools with fixed scopes, allowed actions, tool planning, and audit logging."
        tabs={[
          { id: "tools", label: "Tools", icon: <Bot size={14} /> },
          { id: "runs", label: "Runs", icon: <History size={14} /> },
        ]}
        activeTab="tools"
      >
        <div className="settings-pair" style={{ marginBottom: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Workspace tools</h2>
              <span className="card__subtitle">Each agent is constrained to named read tools and draft-only actions.</span>
            </div>
            <div className="card__body col" style={{ gap: 10 }}>
              {agentList.map((agent) => (
                <button
                  key={agent.key}
                  type="button"
                  className={`btn ${selectedAgent?.key === agent.key ? "btn--accent" : ""}`}
                  style={{
                    justifyContent: "flex-start",
                    height: "auto",
                    padding: 12,
                    textAlign: "left",
                    // .btn defaults to nowrap + inline sizing — override both so the
                    // multi-line summary wraps inside the button instead of pushing
                    // the right edge out of the card.
                    whiteSpace: "normal",
                    width: "100%",
                  }}
                  onClick={() => {
                    setSelectedKey(agent.key);
                    setLastResult(null);
                  }}
                >
                  <span className="col" style={{ gap: 3, minWidth: 0 }}>
                    <strong>{agent.name}</strong>
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{agent.summary}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">{selectedAgent?.name ?? "Select a tool"}</h2>
              <span className="card__subtitle">{selectedAgent?.scope}</span>
            </div>
            {selectedAgent && (
              <div className="card__body col" style={{ gap: 14 }}>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {selectedAgent.allowedActions.map((action) => (
                    <Badge key={action} tone="info">{action}</Badge>
                  ))}
                </div>
                <div className="col" style={{ gap: 6 }}>
                  <strong style={{ fontSize: "var(--fs-sm)" }}>Allowed tools</strong>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {selectedAgent.allowedTools.map((tool) => (
                      <Badge key={tool}>{tool}</Badge>
                    ))}
                  </div>
                </div>
                {selectedAgent.workflowModes?.length ? (
                  <div className="col" style={{ gap: 6 }}>
                    <strong style={{ fontSize: "var(--fs-sm)" }}>Workflow modes</strong>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {selectedAgent.workflowModes.map((mode) => (
                        <Badge key={mode} tone="success">{mode}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {selectedAgent.outputContract?.length ? (
                  <div className="col" style={{ gap: 6 }}>
                    <strong style={{ fontSize: "var(--fs-sm)" }}>Output contract</strong>
                    <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: "var(--fs-sm)" }}>
                      {selectedAgent.outputContract.map((field) => (
                        <li key={field}>{field}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Field label="Run request">
                  <textarea
                    className="textarea"
                    rows={6}
                    value={input}
                    placeholder={selectedAgent.requiredInputHints.join("; ")}
                    onChange={(event) => setInput(event.target.value)}
                  />
                </Field>
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  Required hints: {selectedAgent.requiredInputHints.join(", ")}
                </div>
                <button className="btn btn--accent" disabled={busy || !input.trim()} onClick={startRun}>
                  <Play size={12} /> {busy ? "Logging run..." : "Run bounded tool"}
                </button>
              </div>
            )}
          </div>
        </div>

        {lastResult && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__head">
              <h2 className="card__title">Latest output</h2>
              <span className="card__subtitle">Deterministic guidance stub, logged as an agent run.</span>
            </div>
            <div className="card__body col" style={{ gap: 12 }}>
              <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{lastResult.output}</pre>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {(lastResult.plannedToolCalls ?? []).map((toolCall: any) => (
                  <Badge key={toolCall.toolName} tone="warn">{toolCall.toolName}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Recent runs</h2>
            <span className="card__subtitle">Run records are also mirrored into the main audit log.</span>
          </div>
          <div className="card__body col" style={{ gap: 10 }}>
            {(runs ?? []).length === 0 ? (
              <div className="muted">No agent runs yet.</div>
            ) : (
              (runs ?? []).map((run) => (
                <div
                  key={run._id}
                  className="row"
                  style={{ justifyContent: "space-between", gap: 12, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}
                >
                  <div className="col" style={{ gap: 4 }}>
                    <strong>{run.agentName}</strong>
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{run.input}</span>
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                      {run.allowedTools.length} planned tool request(s)
                    </span>
                  </div>
                  <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                    <Badge tone={run.status === "completed" ? "success" : "warn"}>{run.status}</Badge>
                    <Badge tone="info"><ShieldCheck size={10} /> {run.provider}</Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </SettingsShell>
    </div>
  );
}
