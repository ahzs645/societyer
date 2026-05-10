import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Bot, BrainCircuit, History, ListTree, MessageSquare, Play, Save, ShieldCheck, Trash2, Wrench } from "lucide-react";
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
  modelId?: string;
  skillNames?: string[];
  allowedActions: string[];
  allowedTools: string[];
  requiredInputHints: string[];
  workflowModes?: string[];
  outputContract?: string[];
};

type SkillDefinition = {
  _id?: string;
  name: string;
  label: string;
  description?: string;
  content?: string;
  isCustom?: boolean;
  isActive?: boolean;
};

type ToolCatalog = {
  role: string;
  categories: string[];
  catalog: Record<string, Array<{ name: string; label: string; description: string }>>;
  tools: Array<{ name: string; label: string; category: string; description: string; requiredPermission?: string }>;
};

export function AiAgentsPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const agents = useQuery(api.aiAgents.listDefinitions, {}) as AgentDefinition[] | undefined;
  const skills = useQuery(api.aiAgents.listSkills, society ? { societyId: society._id } : "skip") as SkillDefinition[] | undefined;
  const allSkills = useQuery(api.aiAgents.listAllSkills, society ? { societyId: society._id } : "skip") as SkillDefinition[] | undefined;
  const toolCatalog = useQuery(
    api.aiAgents.getToolCatalog,
    society ? { societyId: society._id, actingUserId } : "skip",
  ) as ToolCatalog | undefined;
  const runs = useQuery(
    api.aiAgents.listRuns,
    society ? { societyId: society._id, limit: 20 } : "skip",
  ) as any[] | undefined;
  const threads = useQuery(api.aiChat.listThreads, society ? { societyId: society._id, limit: 12 } : "skip") as any[] | undefined;
  const runAgent = useMutation(api.aiAgents.runAgent);
  const sendChatMessage = useAction(api.aiChatActions.sendChatMessage);
  const upsertSkill = useMutation(api.aiAgents.upsertSkill);
  const setSkillActive = useMutation(api.aiAgents.setSkillActive);
  const removeSkill = useMutation(api.aiAgents.removeSkill);
  const toast = useToast();

  const [selectedKey, setSelectedKey] = useState("compliance_analyst");
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [lastResult, setLastResult] = useState<any | null>(null);
  const [skillDraft, setSkillDraft] = useState({
    id: "",
    name: "",
    label: "",
    description: "",
    content: "",
    isActive: true,
  });
  const messages = useQuery(
    api.aiChat.messagesForThread,
    selectedThreadId ? { threadId: selectedThreadId as any } : "skip",
  ) as any[] | undefined;

  const agentList = agents ?? [];
  const selectedAgent = useMemo(
    () => agentList.find((agent) => agent.key === selectedKey) ?? agentList[0],
    [agentList, selectedKey],
  );
  const selectedAgentSkills = useMemo(() => {
    const names = new Set(selectedAgent?.skillNames ?? []);
    return (skills ?? []).filter((skill) => names.has(skill.name));
  }, [selectedAgent?.skillNames, skills]);
  const toolsByCategory = toolCatalog?.catalog ?? {};
  const visibleSkills = allSkills ?? skills ?? [];

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
        browsingContext: { route: window.location.pathname, surface: "ai-agents" },
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

  const submitChat = async () => {
    if (!society || !chatInput.trim()) return;
    setChatBusy(true);
    try {
      const result = await sendChatMessage({
        societyId: society._id,
        threadId: selectedThreadId as any,
        content: chatInput.trim(),
        actingUserId,
        browsingContext: { route: window.location.pathname, surface: "ai-agents-chat" },
      });
      setSelectedThreadId(result.threadId);
      setChatInput("");
      toast.success(result.provider === "vercel_ai_sdk" ? "AI reply streamed" : "AI fallback reply saved");
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't send chat message");
    } finally {
      setChatBusy(false);
    }
  };

  const saveSkill = async () => {
    if (!society || !skillDraft.name.trim() || !skillDraft.content.trim()) return;
    try {
      await upsertSkill({
        societyId: society._id,
        actingUserId,
        id: skillDraft.id ? skillDraft.id as any : undefined,
        name: skillDraft.name,
        label: skillDraft.label || skillDraft.name,
        description: skillDraft.description,
        content: skillDraft.content,
        isActive: skillDraft.isActive,
      });
      setSkillDraft({ id: "", name: "", label: "", description: "", content: "", isActive: true });
      toast.success("Skill saved");
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't save skill");
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
          { id: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
          { id: "tools", label: "Agents", icon: <Bot size={14} /> },
          { id: "skills", label: "Skills", icon: <BrainCircuit size={14} /> },
          { id: "catalog", label: "Catalog", icon: <ListTree size={14} /> },
          { id: "runs", label: "Runs", icon: <History size={14} /> },
        ]}
        activeTab="chat"
      >
        <div className="settings-pair" style={{ marginBottom: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">AI chat</h2>
              <span className="card__subtitle">Builds workspace prompt, loads skills, learns tools, then executes permissioned tools.</span>
            </div>
            <div className="card__body col" style={{ gap: 12 }}>
              <div className="col" style={{ gap: 8, maxHeight: 360, overflow: "auto" }}>
                {(messages ?? []).length === 0 ? (
                  <div className="muted">Start a thread to route a request through the AI skill router.</div>
                ) : (
                  (messages ?? []).map((message) => (
                    <div key={message._id} className="col" style={{ gap: 4, padding: 10, border: "1px solid var(--border)", borderRadius: 8 }}>
                      <Badge tone={message.role === "assistant" ? "info" : "neutral"}>{message.role}</Badge>
                      <div style={{ whiteSpace: "pre-wrap", fontSize: "var(--fs-sm)" }}>{message.content}</div>
                    </div>
                  ))
                )}
              </div>
              <Field label="Message">
                <textarea
                  className="textarea"
                  rows={4}
                  value={chatInput}
                  placeholder="Ask the assistant to find records, draft tasks, inspect workflow context, or prepare a filing packet."
                  onChange={(event) => setChatInput(event.target.value)}
                />
              </Field>
              <button className="btn btn--accent" disabled={chatBusy || !chatInput.trim()} onClick={submitChat}>
                <MessageSquare size={12} /> {chatBusy ? "Sending..." : "Send chat message"}
              </button>
            </div>
          </div>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Threads</h2>
              <span className="card__subtitle">Persisted AI conversations for this workspace.</span>
            </div>
            <div className="card__body col" style={{ gap: 8 }}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelectedThreadId(undefined)}>
                New thread
              </button>
              {(threads ?? []).map((thread) => (
                <button
                  key={thread._id}
                  type="button"
                  className={`btn ${selectedThreadId === thread._id ? "btn--accent" : ""}`}
                  style={{ justifyContent: "flex-start", whiteSpace: "normal", height: "auto", padding: 10 }}
                  onClick={() => setSelectedThreadId(thread._id)}
                >
                  {thread.title}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-pair" style={{ marginBottom: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Workspace tools</h2>
              <span className="card__subtitle">Each agent follows plan → skill → learn tools → execute tools.</span>
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
                  <Badge tone="info"><BrainCircuit size={10} /> {selectedAgent.modelId ?? "auto"}</Badge>
                  {(selectedAgent.skillNames ?? []).map((skillName) => (
                    <Badge key={skillName} tone="success">{skillName}</Badge>
                  ))}
                </div>
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
                {selectedAgentSkills.length ? (
                  <div className="col" style={{ gap: 6 }}>
                    <strong style={{ fontSize: "var(--fs-sm)" }}>Loaded skills</strong>
                    {selectedAgentSkills.map((skill) => (
                      <div key={skill.name} className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                        <strong>{skill.label}</strong>: {skill.description}
                      </div>
                    ))}
                  </div>
                ) : null}
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
              <span className="card__subtitle">Skill-router guidance, logged as an agent run.</span>
            </div>
            <div className="card__body col" style={{ gap: 12 }}>
              <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{lastResult.output}</pre>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {(lastResult.loadedSkills ?? []).map((skill: SkillDefinition) => (
                  <Badge key={skill.name} tone="success"><BrainCircuit size={10} /> {skill.name}</Badge>
                ))}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {(lastResult.plannedToolCalls ?? []).map((toolCall: any) => (
                  <Badge key={toolCall.toolName} tone="warn"><Wrench size={10} /> {toolCall.toolName}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="settings-pair" style={{ marginBottom: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Skill router</h2>
              <span className="card__subtitle">Skills are active workspace instructions loaded before complex tool use.</span>
            </div>
            <div className="card__body col" style={{ gap: 10 }}>
              {(visibleSkills ?? []).map((skill) => (
                <div key={skill.name} className="col" style={{ gap: 4, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <strong>{skill.label}</strong>
                    <div className="row" style={{ gap: 6 }}>
                      <Badge tone={skill.isActive === false ? "neutral" : "success"}>{skill.isActive === false ? "Inactive" : "Active"}</Badge>
                      <Badge tone={skill.isCustom ? "warn" : "info"}>{skill.isCustom ? "Custom" : "Built in"}</Badge>
                    </div>
                  </div>
                  <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{skill.description}</span>
                  {skill.isCustom && (
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => setSkillDraft({
                          id: skill._id ?? "",
                          name: skill.name,
                          label: skill.label,
                          description: skill.description ?? "",
                          content: skill.content ?? "",
                          isActive: skill.isActive !== false,
                        })}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => skill._id && setSkillActive({
                          societyId: society._id,
                          actingUserId,
                          id: skill._id as any,
                          isActive: skill.isActive === false,
                        })}
                      >
                        {skill.isActive === false ? "Activate" : "Deactivate"}
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => skill._id && removeSkill({ societyId: society._id, actingUserId, id: skill._id as any })}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <div className="col" style={{ gap: 10, paddingTop: 8 }}>
                <strong>{skillDraft.id ? "Edit custom skill" : "New custom skill"}</strong>
                <div className="settings-pair">
                  <Field label="Name">
                    <input className="input" value={skillDraft.name} onChange={(event) => setSkillDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="grant-reporting-review" />
                  </Field>
                  <Field label="Label">
                    <input className="input" value={skillDraft.label} onChange={(event) => setSkillDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="Grant reporting review" />
                  </Field>
                </div>
                <Field label="Description">
                  <input className="input" value={skillDraft.description} onChange={(event) => setSkillDraft((draft) => ({ ...draft, description: event.target.value }))} />
                </Field>
                <Field label="Content">
                  <textarea className="textarea" rows={5} value={skillDraft.content} onChange={(event) => setSkillDraft((draft) => ({ ...draft, content: event.target.value }))} />
                </Field>
                <label className="row" style={{ gap: 8, fontSize: "var(--fs-sm)" }}>
                  <input type="checkbox" checked={skillDraft.isActive} onChange={(event) => setSkillDraft((draft) => ({ ...draft, isActive: event.target.checked }))} />
                  Active in AI agents and chat prompt
                </label>
                <button className="btn btn--accent" onClick={saveSkill} disabled={!skillDraft.name.trim() || !skillDraft.content.trim()}>
                  <Save size={12} /> Save skill
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Permissioned tool catalog</h2>
              <span className="card__subtitle">Filtered for role: {toolCatalog?.role ?? "Loading"}</span>
            </div>
            <div className="card__body col" style={{ gap: 12 }}>
              {Object.entries(toolsByCategory).map(([category, tools]) => (
                <div key={category} className="col" style={{ gap: 6 }}>
                  <strong style={{ fontSize: "var(--fs-sm)" }}>{category}</strong>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {tools.map((tool) => (
                      <span key={tool.name} title={tool.description}>
                        <Badge>{tool.name}</Badge>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

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
                    {run.loadedSkillNames?.length ? (
                      <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                        Skills: {run.loadedSkillNames.join(", ")}
                      </span>
                    ) : null}
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
