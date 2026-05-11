import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Bot, BrainCircuit, CheckCircle2, History, KeyRound, ListTree, MessageSquare, Play, RefreshCw, Save, Search, ShieldCheck, SlidersHorizontal, Trash2, Wrench, XCircle } from "lucide-react";
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

type AiModelInfo = {
  id: string;
  name: string;
  provider: string;
  contextLength?: number;
  promptPrice?: string;
  completionPrice?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  supportedParameters?: string[];
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsStructuredOutputs?: boolean;
  isFree?: boolean;
};

type AiModelCatalog = {
  provider: string;
  message?: string;
  cached?: boolean;
  stale?: boolean;
  models: AiModelInfo[];
  categories?: Record<string, AiModelInfo[]>;
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
  const toolDrafts = useQuery(api.aiAgents.listToolDrafts, society ? { societyId: society._id, limit: 20 } : "skip") as any[] | undefined;
  const aiSettings = useQuery(api.aiSettings.getEffective, society ? { societyId: society._id, actingUserId } : "skip") as any | undefined;
  const runAgent = useMutation(api.aiAgents.runAgent);
  const sendChatMessage = useAction(api.aiChatActions.sendChatMessage);
  const validateProviderKey = useAction(api.aiSettingsActions.validateProviderKey);
  const listProviderModels = useAction(api.aiSettingsActions.listProviderModels);
  const createSecret = useMutation(api.secrets.create);
  const upsertAiSetting = useMutation(api.aiSettings.upsert);
  const upsertSkill = useMutation(api.aiAgents.upsertSkill);
  const setSkillActive = useMutation(api.aiAgents.setSkillActive);
  const removeSkill = useMutation(api.aiAgents.removeSkill);
  const approveToolDraft = useMutation(api.aiAgents.approveToolDraft);
  const rejectToolDraft = useMutation(api.aiAgents.rejectToolDraft);
  const toast = useToast();

  const [selectedKey, setSelectedKey] = useState("compliance_analyst");
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [lastResult, setLastResult] = useState<any | null>(null);
  const [aiSetup, setAiSetup] = useState({
    scope: "personal",
    provider: "openai",
    label: "OpenAI",
    apiKey: "",
    baseUrl: "",
    modelId: "gpt-4.1-mini",
    temperature: "0.2",
    maxSteps: "6",
  });
  const [validation, setValidation] = useState<any | null>(null);
  const [modelCatalog, setModelCatalog] = useState<AiModelCatalog | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelTab, setModelTab] = useState("recommended");
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
  const effectiveProvider = aiSettings?.effective;
  const isOpenRouter = aiSetup.provider === "openrouter";
  const setupFingerprint = `${aiSetup.provider}|${aiSetup.apiKey.trim()}|${aiSetup.baseUrl.trim()}`;
  const setupValidated = Boolean(validation?.ok && validation.fingerprint === setupFingerprint);

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
    setStreamingText("");
    try {
      const result = await streamChatMessage({
        societyId: society._id,
        threadId: selectedThreadId,
        content: chatInput.trim(),
        actingUserId,
        browsingContext: { route: window.location.pathname, surface: "ai-agents-chat" },
        onToken: (token) => setStreamingText((text) => text + token),
      }).catch(async () =>
        sendChatMessage({
          societyId: society._id,
          threadId: selectedThreadId as any,
          content: chatInput.trim(),
          actingUserId,
          browsingContext: { route: window.location.pathname, surface: "ai-agents-chat" },
        }),
      );
      setSelectedThreadId(result.threadId);
      setChatInput("");
      setStreamingText("");
      toast.success(result.provider === "sse" ? "AI reply streamed" : result.provider === "vercel_ai_sdk" ? "AI reply saved" : "AI fallback reply saved");
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

  const validateProviderAndLoadModels = async () => {
    if (!society || !aiSetup.apiKey.trim()) return;
    setSetupBusy(true);
    try {
      const result = await validateProviderKey({
        provider: aiSetup.provider,
        apiKey: aiSetup.apiKey.trim(),
        baseUrl: aiSetup.provider === "openai-compatible" ? aiSetup.baseUrl.trim() : undefined,
      });
      setValidation({ ...result, fingerprint: setupFingerprint });
      if (result.modelCatalog) setModelCatalog(result.modelCatalog);
      if (!result.ok) {
        toast.error(result.message ?? "Provider key did not validate");
        return;
      }
      const defaultModel = result.modelCatalog?.categories?.recommended?.[0] ?? result.modelCatalog?.models?.[0];
      if (defaultModel?.id && !result.modelCatalog?.models?.some((model: AiModelInfo) => model.id === aiSetup.modelId)) {
        setAiSetup((draft) => ({ ...draft, modelId: defaultModel.id }));
      }
      toast.success("Provider key validated");
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't validate AI provider");
    } finally {
      setSetupBusy(false);
    }
  };

  const saveValidatedProvider = async () => {
    if (!society || !setupValidated) return;
    setSetupBusy(true);
    try {
      const secretId = await createSecret({
        societyId: society._id,
        actingUserId,
        name: `${aiSetup.scope === "workspace" ? "Workspace" : "Personal"} AI provider key - ${aiSetup.label || providerLabel(aiSetup.provider)}`,
        service: `Societyer AI:${aiSetup.provider}`,
        credentialType: "api_key",
        ownerRole: aiSetup.scope === "workspace" ? "Workspace AI" : "Personal AI",
        storageMode: "stored_encrypted",
        secretValue: aiSetup.apiKey.trim(),
        revealPolicy: aiSetup.scope === "workspace" ? "owner_admin" : "owner_admin_custodian",
        status: "Active",
        sensitivity: "high",
        accessLevel: "restricted",
        sourceExternalIds: ["societyer-ai-provider"],
        notes: `Validated ${aiSetup.provider} key for ${aiSetup.modelId}.`,
      });
      await upsertAiSetting({
        societyId: society._id,
        actingUserId,
        scope: aiSetup.scope,
        provider: aiSetup.provider,
        label: aiSetup.label || providerLabel(aiSetup.provider),
        modelId: aiSetup.modelId,
        baseUrl: aiSetup.provider === "openai-compatible" ? aiSetup.baseUrl : undefined,
        secretVaultItemId: secretId,
        temperature: Number(aiSetup.temperature),
        maxSteps: Number(aiSetup.maxSteps),
        validationStatus: "ok",
        validationMessage: validation.message,
      });
      setAiSetup((draft) => ({ ...draft, apiKey: "" }));
      setValidation(null);
      toast.success("AI provider configured");
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't configure AI provider");
    } finally {
      setSetupBusy(false);
    }
  };

  const loadModelCatalog = async (forceRefresh = false) => {
    setModelBusy(true);
    try {
      const result = await listProviderModels({
        provider: aiSetup.provider,
        apiKey: aiSetup.apiKey.trim() || undefined,
        baseUrl: aiSetup.provider === "openai-compatible" ? aiSetup.baseUrl.trim() : undefined,
        societyId: society._id,
        actingUserId,
        forceRefresh,
      });
      setModelCatalog(result);
      if (result.message) toast.info(result.message);
      const currentExists = result.models?.some((model: AiModelInfo) => model.id === aiSetup.modelId);
      const defaultModel = result.categories?.recommended?.[0] ?? result.models?.[0];
      if (!currentExists && defaultModel?.id) {
        setAiSetup((draft) => ({ ...draft, modelId: defaultModel.id }));
      }
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't load provider models");
    } finally {
      setModelBusy(false);
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
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">AI setup</h2>
            <span className="card__subtitle">Onboard a personal or workspace provider key before live chat and agents run.</span>
          </div>
          <div className="card__body col" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Badge tone={effectiveProvider ? "success" : "warn"}>
                <KeyRound size={10} /> {effectiveProvider ? `${effectiveProvider.label} · ${effectiveProvider.modelId}` : "No live provider configured"}
              </Badge>
              {effectiveProvider?.scope && <Badge tone="info">{effectiveProvider.scope}</Badge>}
              {effectiveProvider?.validationStatus && <Badge tone="success">{effectiveProvider.validationStatus}</Badge>}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Badge tone={aiSetup.apiKey.trim() ? "success" : "neutral"}>1. Add key</Badge>
              <Badge tone={setupValidated ? "success" : "neutral"}>2. Choose model</Badge>
              <Badge tone={setupValidated && aiSetup.modelId.trim() ? "info" : "neutral"}>3. Save</Badge>
            </div>
            <div className="settings-pair">
              <Field label="Scope">
                <select className="input" value={aiSetup.scope} onChange={(event) => setAiSetup((draft) => ({ ...draft, scope: event.target.value }))}>
                  <option value="personal">Personal</option>
                  <option value="workspace">Workspace</option>
                </select>
              </Field>
              <Field label="Provider">
                <select
                  className="input"
                  value={aiSetup.provider}
                  onChange={(event) => {
                    const provider = event.target.value;
                    setAiSetup((draft) => ({
                      ...draft,
                      provider,
                      label: providerLabel(provider),
                      modelId: defaultModelForProvider(provider),
                      baseUrl: provider === "openai-compatible" ? draft.baseUrl : "",
                    }));
                    setModelCatalog(null);
                    setModelTab("recommended");
                    setValidation(null);
                  }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="openai-compatible">OpenAI-compatible</option>
                </select>
              </Field>
            </div>
            {aiSetup.provider === "openai-compatible" && (
              <Field label="Base URL">
                <input
                  className="input"
                  value={aiSetup.baseUrl}
                  onChange={(event) => {
                    setAiSetup((draft) => ({ ...draft, baseUrl: event.target.value }));
                    setValidation(null);
                    setModelCatalog(null);
                  }}
                  placeholder="https://api.example.com/v1"
                />
              </Field>
            )}
            <Field label="API key">
              <input
                className="input"
                type="password"
                value={aiSetup.apiKey}
                onChange={(event) => {
                  setAiSetup((draft) => ({ ...draft, apiKey: event.target.value }));
                  setValidation(null);
                  setModelCatalog(null);
                }}
                placeholder={isOpenRouter ? "sk-or-v1-..." : "sk-..."}
              />
            </Field>
            {validation && (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Badge tone={validation.ok ? "success" : "danger"}>{validation.ok ? "Validated" : "Failed"}</Badge>
                <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{validation.message}</span>
              </div>
            )}
            <button className="btn btn--accent" disabled={setupBusy || !aiSetup.apiKey.trim()} onClick={validateProviderAndLoadModels}>
              <ShieldCheck size={12} /> {setupBusy ? "Validating..." : "Validate key and load models"}
            </button>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div className="settings-pair">
              <Field label="Label">
                <input className="input" value={aiSetup.label} onChange={(event) => setAiSetup((draft) => ({ ...draft, label: event.target.value }))} disabled={!setupValidated} />
              </Field>
              <Field label="Selected model">
                <input className="input" value={aiSetup.modelId} onChange={(event) => setAiSetup((draft) => ({ ...draft, modelId: event.target.value }))} placeholder="gpt-4.1-mini" disabled={!setupValidated} />
              </Field>
            </div>
            {isOpenRouter && setupValidated && (
              <ModelSelector
                catalog={modelCatalog}
                busy={modelBusy}
                selectedModelId={aiSetup.modelId}
                search={modelSearch}
                tab={modelTab}
                onSearchChange={setModelSearch}
                onTabChange={setModelTab}
                onLoad={() => loadModelCatalog(false)}
                onRefresh={() => loadModelCatalog(true)}
                onSelect={(modelId) => setAiSetup((draft) => ({ ...draft, modelId }))}
              />
            )}
            {!setupValidated && (
              <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>Validate a provider key before choosing a model or saving settings.</span>
            )}
            <div className="settings-pair">
              <Field label="Temperature">
                <input className="input" type="number" min="0" max="2" step="0.1" value={aiSetup.temperature} onChange={(event) => setAiSetup((draft) => ({ ...draft, temperature: event.target.value }))} disabled={!setupValidated} />
              </Field>
              <Field label="Max tool steps">
                <input className="input" type="number" min="1" max="12" step="1" value={aiSetup.maxSteps} onChange={(event) => setAiSetup((draft) => ({ ...draft, maxSteps: event.target.value }))} disabled={!setupValidated} />
              </Field>
            </div>
            <button className="btn btn--accent" disabled={setupBusy || !setupValidated || !aiSetup.modelId.trim()} onClick={saveValidatedProvider}>
              <SlidersHorizontal size={12} /> {setupBusy ? "Saving..." : "Save AI provider"}
            </button>
          </div>
        </div>

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
                {streamingText && (
                  <div className="col" style={{ gap: 4, padding: 10, border: "1px solid var(--border)", borderRadius: 8 }}>
                    <Badge tone="info">assistant</Badge>
                    <div style={{ whiteSpace: "pre-wrap", fontSize: "var(--fs-sm)" }}>{streamingText}</div>
                  </div>
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

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">AI tool drafts</h2>
            <span className="card__subtitle">Human approval queue for actions produced by chat or agents.</span>
          </div>
          <div className="card__body col" style={{ gap: 10 }}>
            {(toolDrafts ?? []).length === 0 ? (
              <div className="muted">No AI tool drafts yet.</div>
            ) : (
              (toolDrafts ?? []).map((draft) => (
                <div key={draft._id} className="row" style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
                  <div className="col" style={{ gap: 4, minWidth: 0 }}>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <Badge tone={draft.status === "executed" ? "success" : draft.status === "rejected" ? "danger" : "warn"}>{draft.status}</Badge>
                      <Badge>{draft.toolName}</Badge>
                    </div>
                    <strong>{draft.title ?? draft.payload?.title ?? "Untitled draft"}</strong>
                    <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: "var(--fs-xs)" }}>
                      {JSON.stringify(draft.payload, null, 2)}
                    </pre>
                  </div>
                  {draft.status === "draft" && (
                    <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                      <button
                        className="btn btn--accent btn--sm"
                        onClick={async () => {
                          await approveToolDraft({ societyId: society._id, actingUserId, id: draft._id });
                          toast.success("AI draft approved");
                        }}
                      >
                        <CheckCircle2 size={12} /> Approve
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={async () => {
                          await rejectToolDraft({ societyId: society._id, actingUserId, id: draft._id });
                          toast.success("AI draft rejected");
                        }}
                      >
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
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

function ModelSelector({
  catalog,
  busy,
  selectedModelId,
  search,
  tab,
  onSearchChange,
  onTabChange,
  onLoad,
  onRefresh,
  onSelect,
}: {
  catalog: AiModelCatalog | null;
  busy: boolean;
  selectedModelId: string;
  search: string;
  tab: string;
  onSearchChange: (value: string) => void;
  onTabChange: (value: string) => void;
  onLoad: () => void;
  onRefresh: () => void;
  onSelect: (modelId: string) => void;
}) {
  const tabs = [
    ["recommended", "Recommended"],
    ["fastCheap", "Fast / Cheap"],
    ["reasoning", "Reasoning"],
    ["coding", "Coding"],
    ["vision", "Vision"],
    ["free", "Free"],
    ["all", "All models"],
  ];
  const source = catalog?.categories?.[tab] ?? catalog?.models ?? [];
  const needle = search.trim().toLowerCase();
  const models = source
    .filter((model) => {
      if (!needle) return true;
      return [
        model.id,
        model.name,
        model.provider,
        ...(model.supportedParameters ?? []),
        ...(model.inputModalities ?? []),
      ].join(" ").toLowerCase().includes(needle);
    })
    .slice(0, 80);

  return (
    <div className="col" style={{ gap: 10, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn btn--sm ${tab === id ? "btn--accent" : ""}`}
              onClick={() => onTabChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--sm" onClick={catalog ? onRefresh : onLoad} disabled={busy}>
          <RefreshCw size={12} /> {busy ? "Loading" : catalog ? "Refresh" : "Load models"}
        </button>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Search size={14} className="muted" />
        <input
          className="input"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search provider, model, or capability"
        />
      </div>
      {catalog?.message && (
        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{catalog.message}</span>
      )}
      {catalog?.stale && <Badge tone="warn">Cached model list</Badge>}
      <div className="col" style={{ gap: 8, maxHeight: 320, overflow: "auto" }}>
        {models.length === 0 ? (
          <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>No models loaded for this view.</span>
        ) : (
          models.map((model) => (
            <button
              key={model.id}
              type="button"
              className="row"
              onClick={() => onSelect(model.id)}
              style={{
                width: "100%",
                justifyContent: "space-between",
                gap: 12,
                textAlign: "left",
                padding: 10,
                border: `1px solid ${model.id === selectedModelId ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 8,
                background: model.id === selectedModelId ? "var(--accent-soft)" : "var(--surface)",
              }}
            >
              <span className="col" style={{ gap: 4, minWidth: 0 }}>
                <strong style={{ fontSize: "var(--fs-sm)" }}>{model.name}</strong>
                <span className="muted" style={{ fontSize: "var(--fs-xs)", wordBreak: "break-all" }}>{model.id}</span>
              </span>
              <span className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 }}>
                <Badge>{model.provider}</Badge>
                {model.contextLength ? <Badge tone="info">{formatContext(model.contextLength)}</Badge> : null}
                {model.supportsTools ? <Badge tone="success">tools</Badge> : null}
                {model.supportsVision ? <Badge tone="info">image</Badge> : null}
                {model.supportsStructuredOutputs ? <Badge tone="success">structured</Badge> : null}
                {model.isFree ? <Badge tone="success">free</Badge> : null}
                {priceLabel(model) ? <Badge tone="neutral">{priceLabel(model)}</Badge> : null}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function providerLabel(provider: string) {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "openai-compatible") return "OpenAI-compatible";
  return "OpenAI";
}

function defaultModelForProvider(provider: string) {
  if (provider === "openrouter") return "openai/gpt-4.1-mini";
  return "gpt-4.1-mini";
}

function formatContext(value: number) {
  if (value >= 1000) return `${Math.round(value / 1000)}k ctx`;
  return `${value} ctx`;
}

function priceLabel(model: AiModelInfo) {
  const prompt = Number(model.promptPrice);
  const completion = Number(model.completionPrice);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return "";
  return `$${(prompt * 1_000_000).toFixed(2)}/$${(completion * 1_000_000).toFixed(2)} per 1M`;
}

async function streamChatMessage({
  societyId,
  threadId,
  content,
  actingUserId,
  browsingContext,
  onToken,
}: {
  societyId: string;
  threadId?: string;
  content: string;
  actingUserId?: string;
  browsingContext?: unknown;
  onToken: (token: string) => void;
}) {
  const response = await fetch(`${convexSiteUrl()}/ai-chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ societyId, threadId, content, actingUserId, browsingContext }),
  });
  if (!response.ok || !response.body) throw new Error(`Stream failed with ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: any = { threadId, provider: "sse" };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSseEvent(part);
      if (!event) continue;
      if (event.event === "token" && typeof event.data?.text === "string") onToken(event.data.text);
      if (event.event === "ready") result = { ...result, ...event.data, provider: "sse" };
      if (event.event === "done") result = { ...result, ...event.data, provider: "sse" };
      if (event.event === "error") throw new Error(event.data?.error ?? "Streaming failed");
    }
  }
  return result;
}

function parseSseEvent(chunk: string) {
  const lines = chunk.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");
  if (!data) return null;
  return { event, data: JSON.parse(data) };
}

function convexSiteUrl() {
  const apiUrl = String(import.meta.env.VITE_CONVEX_URL ?? "");
  if (apiUrl.includes(":3220")) return apiUrl.replace(":3220", ":3221");
  if (apiUrl.includes(":3210")) return apiUrl.replace(":3210", ":3211");
  return apiUrl.replace(/\/+$/, "");
}
