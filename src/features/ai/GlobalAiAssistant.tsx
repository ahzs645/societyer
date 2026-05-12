import { useAction, useQuery } from "convex/react";
import {
  Bot,
  Check,
  Copy,
  FileText,
  Loader2,
  PanelRightClose,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { streamChatMessage } from "../../lib/aiChatStream";
import { resolveRouteIdentity } from "../../lib/routeIdentity";
import { useCurrentUserId } from "../../hooks/useCurrentUser";
import { useSociety } from "../../hooks/useSociety";
import { useToast } from "../../components/Toast";

const OPEN_EVENT = "societyer-ai:open";

type SuggestedPrompt = {
  id: string;
  label: string;
  icon: typeof Search;
  prompt: string;
};

const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    id: "find-record",
    label: "Find a record",
    icon: Search,
    prompt: "Find the directors whose terms expire in the next 60 days.",
  },
  {
    id: "summarize-page",
    label: "Summarize this page",
    icon: FileText,
    prompt: "Summarize what's on the current screen and flag anything that needs my attention.",
  },
  {
    id: "draft-task",
    label: "Draft a task",
    icon: Plus,
    prompt: "Draft a task for me to follow up on. Details: ",
  },
];

export function openGlobalAiAssistant() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function GlobalAiAssistant() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const sendChatMessage = useAction(api.aiChatActions.sendChatMessage);
  const aiSettings = useQuery(api.aiSettings.getEffective, society ? { societyId: society._id, actingUserId } : "skip") as any | undefined;
  const threads = useQuery(api.aiChat.listThreads, society ? { societyId: society._id, limit: 10 } : "skip") as any[] | undefined;
  const toolDrafts = useQuery(api.aiAgents.listToolDrafts, society ? { societyId: society._id, limit: 8 } : "skip") as any[] | undefined;

  const [open, setOpen] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [busy, setBusy] = useState(false);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const messages = useQuery(
    api.aiChat.messagesForThread,
    selectedThreadId ? { threadId: selectedThreadId as any } : "skip",
  ) as any[] | undefined;

  const browsingContext = useMemo(
    () => buildBrowsingContext({
      pathname: location.pathname,
      search: location.search,
      society,
    }),
    [location.pathname, location.search, society?._id],
  );

  const effectiveProvider = aiSettings?.effective;
  const draftCount = (toolDrafts ?? []).filter((draft) => draft.status === "draft").length;
  const hasMessages = (messages?.length ?? 0) > 0 || Boolean(streamingText);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!selectedThreadId && threads?.[0]?._id) setSelectedThreadId(threads[0]._id);
  }, [selectedThreadId, threads]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages?.length, streamingText]);

  useEffect(() => {
    if (open) composerRef.current?.focus();
  }, [open, selectedThreadId]);

  const startNewThread = () => {
    setSelectedThreadId(undefined);
    setInput("");
    setStreamingText("");
    composerRef.current?.focus();
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!society || !input.trim()) return;
    const content = input.trim();
    setBusy(true);
    setStreamingText("");
    try {
      const result = await streamChatMessage({
        societyId: society._id,
        threadId: selectedThreadId,
        content,
        actingUserId,
        browsingContext,
        onToken: (token) => setStreamingText((text) => text + token),
      }).catch(() =>
        sendChatMessage({
          societyId: society._id,
          threadId: selectedThreadId as any,
          content,
          actingUserId,
          browsingContext,
        }),
      );
      setSelectedThreadId(result.threadId);
      setInput("");
      setStreamingText("");
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't send AI message");
    } finally {
      setBusy(false);
    }
  };

  const openSettings = () => {
    navigate("/app/ai-agents");
    setOpen(false);
  };

  const usePrompt = (prompt: string) => {
    setInput(prompt);
    composerRef.current?.focus();
    const el = composerRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.setSelectionRange(prompt.length, prompt.length);
      });
    }
  };

  const providerLabel = effectiveProvider?.status === "active"
    ? `${effectiveProvider.label} · ${effectiveProvider.modelId}`
    : "Provider not configured";
  const providerActive = effectiveProvider?.status === "active";

  return (
    <>
      <button
        type="button"
        className="global-ai-trigger"
        onClick={() => setOpen(true)}
        aria-label="Open AI assistant"
        title="AI assistant"
      >
        <Bot size={16} />
        {draftCount > 0 && <span className="global-ai-trigger__dot">{draftCount}</span>}
      </button>

      {open && (
        <div className="global-ai-shell" role="dialog" aria-modal="true" aria-label="Societyer AI assistant">
          <button className="global-ai-backdrop" type="button" aria-label="Close AI assistant" onClick={() => setOpen(false)} />
          <aside className="global-ai-drawer">
            <header className="global-ai-drawer__head">
              <div className="global-ai-title">
                <span className="global-ai-title__icon">
                  <Sparkles size={14} />
                </span>
                <div>
                  <strong>AI assistant</strong>
                  <span>{browsingContext.label}</span>
                </div>
              </div>
              <div className="global-ai-head-actions">
                {draftCount > 0 && (
                  <span className="global-ai-draftcount" title={`${draftCount} draft action${draftCount === 1 ? "" : "s"}`}>
                    <Wrench size={11} /> {draftCount}
                  </span>
                )}
                <button type="button" className="icon-btn" onClick={openSettings} aria-label="AI settings" title="AI settings">
                  <Settings size={14} />
                </button>
                <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close AI assistant" title="Close">
                  <PanelRightClose size={14} />
                </button>
              </div>
            </header>

            <div className="global-ai-body">
              <section className="global-ai-thread-list" aria-label="AI threads">
                <div className="global-ai-thread-list__header">Recents</div>
                <div className="global-ai-thread-list__items">
                  {(threads ?? []).map((thread) => (
                    <button
                      key={thread._id}
                      type="button"
                      className={`global-ai-thread${selectedThreadId === thread._id ? " is-active" : ""}`}
                      onClick={() => setSelectedThreadId(thread._id)}
                    >
                      <span className="global-ai-thread__icon"><Sparkles size={12} /></span>
                      <span className="global-ai-thread__title">{thread.title}</span>
                    </button>
                  ))}
                  {(threads ?? []).length === 0 && (
                    <div className="global-ai-thread-list__empty">No chats yet</div>
                  )}
                </div>
                <button type="button" className="global-ai-thread-new" onClick={startNewThread}>
                  <Plus size={13} /> New chat
                </button>
              </section>

              <section className="global-ai-main" aria-label="AI conversation">
                <div className="global-ai-messages" ref={scrollerRef}>
                  {!hasMessages ? (
                    <div className="global-ai-empty">
                      <div className="global-ai-empty__title">What can I help you with?</div>
                      <div className="global-ai-empty__prompts">
                        {SUGGESTED_PROMPTS.map((prompt) => {
                          const Icon = prompt.icon;
                          return (
                            <button
                              key={prompt.id}
                              type="button"
                              className="global-ai-suggested-prompt"
                              onClick={() => usePrompt(prompt.prompt)}
                            >
                              <Icon size={13} />
                              <span>{prompt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    (messages ?? []).map((message) => <GlobalAiMessage key={message._id} message={message} />)
                  )}
                  {streamingText && (
                    <GlobalAiMessage
                      message={{
                        _id: "streaming",
                        role: "assistant",
                        content: streamingText,
                        status: "streaming",
                      }}
                    />
                  )}
                </div>

                <form className="global-ai-composer" onSubmit={submit}>
                  <div className="global-ai-composer__context">
                    <span className="global-ai-context-chip" title={browsingContext.route}>
                      <FileText size={11} /> {browsingContext.label}
                    </span>
                  </div>
                  <div className="global-ai-composer__box">
                    <textarea
                      ref={composerRef}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="Ask the assistant to inspect this page, find records, draft tasks, or use workspace tools."
                      rows={3}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
                      }}
                    />
                    <div className="global-ai-composer__bar">
                      <span className={`global-ai-model${providerActive ? "" : " is-muted"}`}>
                        <span className={`global-ai-model__dot${providerActive ? " is-on" : ""}`} />
                        {providerLabel}
                      </span>
                      <button
                        type="submit"
                        className="global-ai-send"
                        disabled={busy || !input.trim() || !society}
                        aria-label="Send message"
                        title="Send (⌘/Ctrl + Enter)"
                      >
                        {busy ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                      </button>
                    </div>
                  </div>
                </form>
              </section>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function GlobalAiMessage({ message }: { message: any }) {
  const isAssistant = message.role === "assistant";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  return (
    <article className={`global-ai-message ${isAssistant ? "global-ai-message--assistant" : "global-ai-message--user"}`}>
      <div className="global-ai-message__content">{message.content}</div>
      {message.toolCalls && (
        <pre className="global-ai-message__tools">{JSON.stringify(message.toolCalls, null, 2)}</pre>
      )}
      {isAssistant && message.content && message.status !== "streaming" && (
        <div className="global-ai-message__footer">
          <button type="button" className="global-ai-message__copy" onClick={copy} aria-label="Copy message">
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {message.status === "streaming" && (
        <div className="global-ai-message__footer">
          <span className="global-ai-streaming-dot" /> Thinking
        </div>
      )}
    </article>
  );
}

function buildBrowsingContext({
  pathname,
  search,
  society,
}: {
  pathname: string;
  search: string;
  society: any;
}) {
  const route = resolveRouteIdentity(pathname);
  const params = new URLSearchParams(search);
  const segments = pathname.split("/").filter(Boolean);
  const recordId = inferRecordId(segments);
  const queryParams = Object.fromEntries(params.entries());
  const label = route?.label ?? "Current page";

  return {
    type: recordId ? "recordPage" : "appPage",
    label,
    route: pathname,
    search,
    routeGroup: route?.group,
    objectNameSingular: inferObjectName(pathname),
    recordId,
    viewId: params.get("view") ?? undefined,
    queryParams,
    society: society
      ? {
          id: society._id,
          name: society.name,
          incorporationNumber: society.incorporationNumber,
        }
      : undefined,
    capturedAtISO: new Date().toISOString(),
  };
}

function inferRecordId(segments: string[]) {
  if (segments.length < 3) return undefined;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment || ["app", "new", "edit", "prefill"].includes(segment)) continue;
    if (/^[a-z0-9]{20,}$/i.test(segment)) return segment;
  }
  return undefined;
}

function inferObjectName(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const appIndex = segments.indexOf("app");
  const objectSegment = appIndex >= 0 ? segments[appIndex + 1] : segments[0];
  if (!objectSegment) return undefined;
  const normalized = objectSegment.replace(/-/g, "_");
  if (normalized.endsWith("ies")) return `${normalized.slice(0, -3)}y`;
  return normalized.replace(/s$/, "");
}
