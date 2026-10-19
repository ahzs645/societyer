import { isLocalDataRuntime, isStaticDemoRuntime } from "../../lib/staticRuntime";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { useAction, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowDown,
  Building2,
  Check,
  ChevronDown,
  Copy,
  FileText,
  KeyRound,
  Loader2,
  MapPin,
  MessagesSquare,
  MoreHorizontal,
  PanelRightClose,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { streamChatMessage, isChatStreamUnavailable } from "../../lib/aiChatStream";
import { AI_ATTACHMENT_ACCEPT, AI_ATTACHMENT_MAX_BYTES, AI_ATTACHMENT_MAX_FILES, composeAiMessage, readAiTextAttachment, type AiTextAttachment } from "../../../shared/aiAttachments";
import { buildLocalAssistantMessages } from "../../../shared/ai/localAssistantPrompt";
import { todayDateOnly } from "../../../shared/dateOnly";
import { DEVICE_AI_SETTINGS_HREF, useDeviceAi, useDeviceToolSupport } from "../../lib/localAi/useDeviceAi";
import { deviceAiClient } from "../../lib/localAi/client";
import { rememberDeviceToolSupport } from "../../lib/localAi/toolSupport";
import { dismissedChange, runApprovedChange, runDeviceAssistantTurn, type DeviceAssistantEvent } from "../../lib/localAi/assistantToolLoop";
import { DEVICE_TOOL_RECORD_LIMITS, parseDeviceToolRecords, type DeviceToolRecord } from "../../../shared/ai/deviceToolRecords";
import { findAgentTool } from "../../../shared/agentTools";
import { useDeviceAssistantTools } from "./useDeviceAssistantTools";
import { DeviceToolActivity } from "./DeviceToolActivity";
import { resolveRouteIdentity } from "../../lib/routeIdentity";
import { useCurrentUserId } from "../../hooks/useCurrentUser";
import { useSociety } from "../../hooks/useSociety";
import { Skeleton } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/Modal";

import { OPEN_AI_ASSISTANT_EVENT as OPEN_EVENT, takePendingAiAssistantOpen } from "./aiAssistantEvents";
import { Tooltip } from "../../components/Tooltip";
import { useDialogFocus } from "../../lib/useDialogFocus";
import { useKeyboardInsetTracking } from "../../lib/useVisualViewportBottomInset";
import { MarkdownTable } from "./MarkdownTable";
import { assistantCapabilities, assistantEmptyHint, assistantPlaceholder, assistantSuggestions, type SuggestedPrompt } from "./assistantSuggestions";
export { openGlobalAiAssistant } from "./aiAssistantEvents";

type ModelOption = { id: string; label: string; provider: string };

/** Stop pressed before the on-device model wrote anything: nothing to keep. */
class StoppedBeforeReply extends Error {
  constructor() {
    super("Stopped before the reply started.");
    this.name = "StoppedBeforeReply";
  }
}

/** Shown on the Attach button (tooltip, and its accessible description). */
const AI_ATTACHMENT_LIMITS = `Up to ${AI_ATTACHMENT_MAX_FILES} UTF-8 TXT, Markdown, CSV or JSON files, ${AI_ATTACHMENT_MAX_BYTES / 1024} KiB each. PDF, images and office files need an extraction service.`;

const FALLBACK_MODELS: ModelOption[] = [
  { id: "google/gemma-2-27b-it:free", label: "Gemma 2 27B (free)", provider: "openrouter" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B", provider: "openrouter" },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", provider: "openrouter" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
];

export function GlobalAiAssistant({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const society = useSociety();
  const { can } = usePermissions();
  const canRead = can("tasks:read");
  const canWrite = can("tasks:write");
  const localOnly = isLocalDataRuntime() && !isStaticDemoRuntime();
  // Local and desktop workspaces chat with the on-device model when one is set up,
  // with the shared agent tools when they are turned on and the model takes them.
  const deviceAi = useDeviceAi("assistant");
  const deviceChat = localOnly && deviceAi.ready;
  const deviceModel = deviceAi.config.model;
  const deviceToolSupport = useDeviceToolSupport(deviceAi.config);
  // Suggestions, placeholder and notices follow what the assistant can do here.
  const capabilities = assistantCapabilities({ localOnly, deviceChat, deviceConfig: deviceAi.config, deviceToolSupport });
  const suggestions = assistantSuggestions(capabilities);
  const emptyHint = assistantEmptyHint(capabilities);
  const canSend = canWrite && (!localOnly || deviceChat);
  const canReadSettings = can("settings:read");
  const canListModels = can("settings:write") && !localOnly;
  const [open, setOpen] = useState(initiallyOpen);
  const closeAssistant = useCallback(() => setOpen(false), []);
  const actingUserId = useCurrentUserId() ?? undefined;
  const deviceWorkspace = useMemo(
    () => (society ? { id: String(society._id), name: society.name, jurisdictionCode: society.jurisdictionCode, entityType: society.entityType } : undefined),
    [society],
  );
  const deviceTools = useDeviceAssistantTools({
    enabled: deviceChat && capabilities.toolsAvailable,
    proposeChanges: localOnly && deviceAi.config.assistantTools.proposeChanges,
    workspace: localOnly ? deviceWorkspace : undefined,
    userId: actingUserId,
  });
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const sendChatMessage = useAction(api.aiChatActions.sendChatMessage);
  const listProviderModels = useAction(api.aiSettingsActions.listProviderModels);
  const archiveThread = usePermissionedMutation(api.aiChat.archiveThread, canWrite);
  const renameThread = usePermissionedMutation(api.aiChat.renameThread, canWrite);
  const deleteThread = usePermissionedMutation(api.aiChat.deleteThread, canWrite);
  const createThread = usePermissionedMutation(api.aiChat.createThread, canWrite);
  const appendDeviceMessage = usePermissionedMutation(api.aiChat.appendDeviceMessage, canWrite);
  const deviceAbortRef = useRef<AbortController | null>(null);
  /** Set by Stop, so an abort keeps the partial reply instead of failing. */
  const deviceStopRef = useRef(false);
  const approveDraft = usePermissionedMutation(api.aiAgents.approveToolDraft, canWrite);
  const rejectDraft = usePermissionedMutation(api.aiAgents.rejectToolDraft, canWrite);

  const aiSettings = useQuery(
    api.aiSettings.getEffective,
    open && canRead && canReadSettings && society ? { societyId: society._id } : "skip",
  ) as any | undefined;
  const threads = useQuery(
    api.aiChat.listThreads,
    open && canWrite && society ? { societyId: society._id, limit: 30 } : "skip",
  ) as any[] | undefined;
  const toolDrafts = useQuery(
    api.aiAgents.listToolDrafts,
    open && canWrite && society ? { societyId: society._id, limit: 12 } : "skip",
  ) as any[] | undefined;

  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const [creatingNewThread, setCreatingNewThread] = useState(false);
  // Phones: the chat list folds behind a "Chats" button (closed by default) so the conversation keeps the height.
  const [chatsOpen, setChatsOpen] = useState(false);
  const chatListId = useId();
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  // On-device turns are saved only once the model answers; show the question meanwhile.
  const [pendingQuestion, setPendingQuestion] = useState("");
  // What the on-device model is looking up while it works on the reply.
  const [liveToolRecords, setLiveToolRecords] = useState<DeviceToolRecord[]>([]);
  // A proposed change being approved or dismissed (one at a time).
  const [settlingProposalId, setSettlingProposalId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickedModelId, setPickedModelId] = useState<string | undefined>();
  const [modelCatalog, setModelCatalog] = useState<ModelOption[] | undefined>();
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AiTextAttachment[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const authorityKey = `${society?._id ?? ""}:${actingUserId ?? ""}:${localOnly}:${canWrite}`;
  const authorityRef = useRef(authorityKey);
  authorityRef.current = authorityKey;
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | undefined>();
  useEffect(() => {
    if (!localOnly || !society?._id) return;
    const key = `societyer:ai-draft:${society._id}`;
    try { setInput(localStorage.getItem(key) ?? ""); } catch { /* Storage unavailable: keep the in-memory draft. */ }
    setLoadedDraftKey(key);
  }, [localOnly, society?._id]);
  useEffect(() => {
    if (!localOnly || !society?._id || loadedDraftKey !== `societyer:ai-draft:${society._id}`) return;
    try { localStorage.setItem(loadedDraftKey, input); } catch { /* Preserve the in-memory draft. */ }
  }, [localOnly, society?._id, input, loadedDraftKey]);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const messages = useQuery(
    api.aiChat.messagesForThread,
    open && canWrite && selectedThreadId && threads?.some((thread) => thread._id === selectedThreadId && thread.societyId === society?._id) ? { threadId: selectedThreadId as any } : "skip",
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
  const draftCount = canWrite ? (toolDrafts ?? []).filter((draft) => draft.status === "draft").length : 0;
  const hasMessages = canWrite && ((messages?.length ?? 0) > 0 || Boolean(streamingText) || Boolean(pendingQuestion));
  const threadsLoading = canWrite && threads === undefined;
  const messagesLoading = Boolean(selectedThreadId) && messages === undefined;

  const selectedThread = useMemo(
    () => (selectedThreadId ? threads?.find((thread) => thread._id === selectedThreadId) : undefined),
    [selectedThreadId, threads],
  );
  const lockedModelId: string | undefined = selectedThread?.modelId;
  const isModelLocked = Boolean(lockedModelId);
  const currentModelId =
    lockedModelId ?? pickedModelId ?? effectiveProvider?.modelId ?? undefined;

  const threadGroups = useMemo(() => groupThreadsByDate(canWrite ? threads ?? [] : []), [threads, canWrite]);
  const chatCount = threadGroups.reduce((total, group) => total + group.threads.length, 0);
  // A proposal is settled once a later on-device message approves or dismisses it.
  const settledProposalIds = useMemo(
    () => new Set((messages ?? []).flatMap((message) => parseDeviceToolRecords(message.toolCalls)).flatMap((record) => (record.resolves ? [record.resolves] : []))),
    [messages],
  );
  const pendingDraftsForThread = useMemo(() => {
    if (!selectedThreadId) return [];
    return (toolDrafts ?? []).filter(
      (draft) => draft.status === "draft" && draft.runId === selectedThreadId,
    );
  }, [toolDrafts, selectedThreadId]);

  useEffect(() => {
    if (!canRead || !canListModels || !open || catalogLoaded || !effectiveProvider?.provider) return;
    let cancelled = false;
    setCatalogLoaded(true);
    listProviderModels({
      provider: effectiveProvider.provider,
      societyId: society?._id,
    })
      .then((result: any) => {
        if (cancelled) return;
        const list = normalizeCatalog(result, effectiveProvider.provider);
        if (list.length > 0) setModelCatalog(list);
      })
      .catch(() => {
        if (!cancelled) setModelCatalog(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, canListModels, open, catalogLoaded, effectiveProvider?.provider, society?._id, actingUserId, listProviderModels]);

  useEffect(() => {
    const onOpen = () => {
      if (!canRead) return;
      takePendingAiAssistantOpen();
      setOpen(true);
    };
    // A click made while this component was still loading (or before the
    // viewer's permissions resolved) opens it now instead of being lost.
    if (canRead && takePendingAiAssistantOpen()) setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [canRead]);

  // Dialog keyboard handling: Esc closes (after any menu or picker open in
  // it), Tab stays inside, and closing returns focus to the control that
  // opened the assistant. The composer is its first focus.
  const shellRef = useDialogFocus<HTMLDivElement>(open && canRead, closeAssistant);
  // The composer stays above the on-screen keyboard (CSS reads the inset).
  useKeyboardInsetTracking(open && canRead);

  useEffect(() => {
    setSelectedThreadId(undefined);
    setCreatingNewThread(false);
    setAttachedFiles([]);
    setStreamingText("");
    setLastError(null);
    setBusy(false);
    setFilesLoading(false);
    setPickedModelId(undefined);
    setModelCatalog(undefined);
    setCatalogLoaded(false);
    if (!localOnly || !canWrite) setInput("");
    return () => deviceAbortRef.current?.abort();
  }, [society?._id, actingUserId, localOnly, canWrite]);

  useEffect(() => {
    if (canWrite && !creatingNewThread && !selectedThreadId && threads?.[0]?._id) setSelectedThreadId(threads[0]._id);
  }, [selectedThreadId, threads, creatingNewThread, canWrite]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    if (!showScrollToBottom) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages?.length, streamingText, showScrollToBottom]);

  useEffect(() => {
    if (open) composerRef.current?.focus();
  }, [open, selectedThreadId]);

  const onScrollerScroll = () => {
    const node = scrollerRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 120);
  };

  const scrollToBottom = () => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  };

  const startNewThread = () => {
    if (!canWrite) return;
    setSelectedThreadId(undefined);
    setCreatingNewThread(true);
    setChatsOpen(false);
    setInput("");
    setStreamingText("");
    setAttachedFiles([]);
    setLastError(null);
    setPickedModelId(undefined);
    composerRef.current?.focus();
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend || busy || filesLoading || !open || !society || !input.trim()) return;
    const submissionAuthority = authorityKey;
    const trimmed = input.trim();
    const content = trimmed;
    // Per-thread model lock: only send a modelId hint when starting a new thread.
    // For existing threads, the backend reads the thread's locked modelId itself.
    const modelIdForRequest = selectedThreadId ? undefined : pickedModelId;
    setBusy(true);
    setStreamingText("");
    setLastError(null);
    try {
      const sendAction = () => sendChatMessage({
        societyId: society._id,
        threadId: selectedThreadId as any,
        content,
        attachments: attachedFiles,
        browsingContext,
        modelId: modelIdForRequest,
      });
      const result = deviceChat ? await sendOnDevice(content, submissionAuthority) : isStaticDemoRuntime() ? await sendAction() : await streamChatMessage({
        societyId: society._id,
        threadId: selectedThreadId,
        content,
        attachments: attachedFiles,
        browsingContext,
        modelId: modelIdForRequest,
        onThreadReady: (id) => { if (authorityRef.current === submissionAuthority) { setSelectedThreadId(id); setCreatingNewThread(false); } },
        onToken: (token) => { if (authorityRef.current === submissionAuthority) setStreamingText((text) => text + token); },
      }).catch((error) => {
        if (!isChatStreamUnavailable(error) || authorityRef.current !== submissionAuthority) throw error;
        return sendAction();
      });
      if (authorityRef.current !== submissionAuthority) return;
      setSelectedThreadId(result.threadId);
      setCreatingNewThread(false);
      if (result.provider === "deterministic_fallback" || result.status === "error") throw new Error("Live AI did not complete this request. Your draft is retained; check AI provider setup and the saved conversation before retrying.");
      setInput("");
      setStreamingText("");
      setAttachedFiles([]);
    } catch (error: any) {
      if (authorityRef.current !== submissionAuthority) return;
      // Stopped before the model said anything: nothing was saved and the draft stays.
      if (error instanceof StoppedBeforeReply) {
        setStreamingText("");
        return;
      }
      const message = error?.message ?? "Couldn't send AI message";
      setLastError(message);
      toast.error(message);
    } finally {
      if (authorityRef.current === submissionAuthority) setBusy(false);
    }
  };

  /**
   * On-device turn: stream the reply from this device's model, then save the
   * question and answer through the portable chat mutations. With tools on,
   * the model may look records up first (runDeviceAssistantTurn); what it
   * looked up or proposed is saved with the answer. Nothing is saved when the
   * model fails, so the draft can simply be sent again.
   */
  const sendOnDevice = async (text: string, submissionAuthority: string) => {
    if (!society) throw new Error("Workspace not loaded yet.");
    const current = () => authorityRef.current === submissionAuthority;
    const userContent = composeAiMessage(text, attachedFiles);
    setPendingQuestion(text);
    const history = selectedThreadId ? (messages ?? []).filter((message) => message.status !== "error") : [];
    const turns = [...history, { role: "user", content: userContent }];
    const promptContext = { organizationName: society.name, pageLabel: browsingContext.label, route: browsingContext.route, today: todayDateOnly() };
    const messagesWithoutTools = buildLocalAssistantMessages(promptContext, turns);
    const tools = deviceTools.tools;
    deviceAbortRef.current?.abort();
    const controller = new AbortController();
    deviceAbortRef.current = controller;
    deviceStopRef.current = false;
    let partial = "";
    const records = new Map<string, DeviceToolRecord>();
    const onEvent = (event: DeviceAssistantEvent) => {
      if (event.type === "token") {
        partial += event.text;
        if (current()) setStreamingText((streamed) => streamed + event.text);
      } else if (event.type === "discard_text") {
        // That text was a tool call, not the answer.
        partial = "";
        if (current()) setStreamingText("");
      } else if (event.type === "tool") {
        records.set(event.record.id, event.record);
        if (current()) setLiveToolRecords([...records.values()]);
      } else {
        rememberDeviceToolSupport(deviceAi.config, "unsupported");
      }
    };
    try {
      const client = deviceAiClient();
      const reply = await (tools.length
        ? runDeviceAssistantTurn({
            client,
            adapter: deviceTools.adapter(),
            messages: buildLocalAssistantMessages(promptContext, turns, { canProposeChanges: tools.some((tool) => tool.kind !== "read") }),
            messagesWithoutTools,
            tools,
            onEvent,
            signal: controller.signal,
          }).then((turn) => {
            if (turn.records.length) rememberDeviceToolSupport(deviceAi.config, "supported");
            return turn.text;
          })
        : client.streamChat({ messages: messagesWithoutTools, onToken: (token) => onEvent({ type: "token", text: token }), signal: controller.signal })
      ).catch((error: unknown) => {
        if (controller.signal.aborted && deviceStopRef.current) return null;
        throw error;
      });
      if (reply === null && !partial.trim()) throw new StoppedBeforeReply();
      // A stopped reply is kept as far as it got, and says so.
      const content = reply ?? `${partial.trimEnd()}\n\n*(stopped)*`;
      const toolCalls = [...records.values()].filter((record) => record.status !== "running").slice(0, DEVICE_TOOL_RECORD_LIMITS.perMessage);
      const threadId = selectedThreadId ?? await createThread({ societyId: society._id, title: text, modelId: deviceModel, browsingContext });
      await appendDeviceMessage({ societyId: society._id, threadId, role: "user", content: userContent, modelId: deviceModel });
      await appendDeviceMessage({ societyId: society._id, threadId, role: "assistant", content, modelId: deviceModel, ...(toolCalls.length ? { toolCalls } : {}) });
      return { threadId, provider: "on_device", status: "complete" };
    } finally {
      setPendingQuestion("");
      setLiveToolRecords([]);
      if (deviceAbortRef.current === controller) deviceAbortRef.current = null;
    }
  };

  /**
   * Approve runs the proposed change as this person, exactly as shown; Dismiss
   * runs nothing. Either way a short note is saved in the chat, which settles
   * the proposal and tells the model next turn.
   */
  const settleProposal = async (proposal: DeviceToolRecord, decision: "approve" | "dismiss") => {
    if (!canWrite || !society || !selectedThreadId || settlingProposalId) return;
    setSettlingProposalId(proposal.id);
    try {
      const outcome = decision === "approve" ? await runApprovedChange(deviceTools.adapter(), proposal, deviceTools.changeTools) : dismissedChange(proposal);
      const note = decision === "approve" ? `Approved: ${outcome.summary}.` : "Dismissed the proposed change. Nothing was changed.";
      await appendDeviceMessage({ societyId: society._id, threadId: selectedThreadId, role: "assistant", content: note, modelId: deviceModel, toolCalls: [outcome] });
      if (decision === "approve") toast.success(outcome.summary, "Made in this workspace as you.");
    } catch (error) {
      toast.error(decision === "approve" ? "Couldn't make the change" : "Couldn't dismiss the change", error instanceof Error ? error.message : undefined);
    } finally {
      setSettlingProposalId(null);
    }
  };

  const stopOnDevice = () => {
    deviceStopRef.current = true;
    deviceAbortRef.current?.abort();
  };

  const openSettings = () => {
    if (!canReadSettings) return;
    navigate(localOnly ? DEVICE_AI_SETTINGS_HREF : "/app/ai-agents");
    setOpen(false);
  };

  const applySuggestedPrompt = (prompt: SuggestedPrompt) => {
    const variant = prompt.prefills[Math.floor(Math.random() * prompt.prefills.length)];
    setInput(variant);
    composerRef.current?.focus();
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (el) el.setSelectionRange(variant.length, variant.length);
    });
  };

  const onSelectThread = (id: string) => {
    setSelectedThreadId(id);
    setCreatingNewThread(false);
    setChatsOpen(false);
    setStreamingText("");
    setLastError(null);
  };

  const handleRename = async (threadId: string, title: string) => {
    if (!canWrite) return;
    try {
      await renameThread({ threadId: threadId as any, title });
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't rename thread");
    }
  };

  const handleArchive = async (threadId: string) => {
    if (!canWrite) return;
    try {
      await archiveThread({ threadId: threadId as any });
      if (threadId === selectedThreadId) setSelectedThreadId(undefined);
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't archive thread");
    }
  };

  const handleDelete = async (threadId: string) => {
    if (!canWrite) return;
    if (!(await confirm({ title: "Delete chat thread?", message: "This can't be undone.", confirmLabel: "Delete thread", tone: "danger" }))) return;
    try {
      await deleteThread({ threadId: threadId as any });
      if (threadId === selectedThreadId) setSelectedThreadId(undefined);
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't delete thread");
    }
  };

  const handleApproveDraft = async (draftId: string) => {
    if (!canWrite) return;
    if (!society) return;
    try {
      await approveDraft({ societyId: society._id, id: draftId as any });
      toast.success("Approved draft");
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't approve");
    }
  };

  const handleRejectDraft = async (draftId: string) => {
    if (!canWrite) return;
    if (!society) return;
    try {
      await rejectDraft({ societyId: society._id, id: draftId as any });
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't reject");
    }
  };

  const handleFilesPicked = async (files: FileList | null) => {
    if (!canWrite || busy || filesLoading || !files?.length) return;
    const fileAuthority = authorityKey;
    setFilesLoading(true);
    try {
      if (attachedFiles.length + files.length > AI_ATTACHMENT_MAX_FILES) throw new Error(`Attach at most ${AI_ATTACHMENT_MAX_FILES} text files.`);
      const next = await Promise.all(Array.from(files).map(readAiTextAttachment));
      if (authorityRef.current !== fileAuthority) return;
      setAttachedFiles((prev) => [...prev, ...next]);
      setLastError(null);
    } catch (error) {
      if (authorityRef.current !== fileAuthority) return;
      setLastError(error instanceof Error ? error.message : "Couldn't read attached text.");
    } finally {
      if (authorityRef.current === fileAuthority) setFilesLoading(false);
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFile(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);
    void handleFilesPicked(event.dataTransfer?.files ?? null);
  };

  const providerActive = effectiveProvider?.status === "active";
  const modelOptions: ModelOption[] = modelCatalog ?? FALLBACK_MODELS;

  return (
    <>
      {open && canRead && (
        <div ref={shellRef} className="global-ai-shell" role="dialog" aria-modal="true" aria-label="Societyer AI assistant" tabIndex={-1}>
          <button className="global-ai-backdrop" type="button" aria-label="Close AI assistant" tabIndex={-1} onClick={closeAssistant} />
          <aside
            className="global-ai-drawer"
            onDragEnter={handleDragEnter}
            onDragOver={(e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); }}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <header className="global-ai-drawer__head">
              <div className="global-ai-title">
                <span className="global-ai-title__icon">
                  <Sparkles size={14} />
                </span>
                <div>
                  <strong>AI assistant</strong>
                  <span>{deviceChat ? `On-device model: ${deviceModel} · ${browsingContext.label}` : browsingContext.label}</span>
                </div>
              </div>
              <div className="global-ai-head-actions">
                {draftCount > 0 && (
                  <span className="global-ai-draftcount" title={`${draftCount} draft action${draftCount === 1 ? "" : "s"}`}>
                    <Wrench size={11} /> {draftCount}
                  </span>
                )}
                <Tooltip content="AI settings">
                  <button type="button" className="icon-btn global-ai-icon-btn" onClick={openSettings} disabled={!canReadSettings} aria-label="AI settings">
                    <Settings size={14} />
                  </button>
                </Tooltip>
                <Tooltip content="Close">
                  <button type="button" className="icon-btn global-ai-icon-btn" onClick={closeAssistant} aria-label="Close AI assistant">
                    <PanelRightClose size={14} />
                  </button>
                </Tooltip>
              </div>
            </header>

            <div className="global-ai-body">
              <section className={`global-ai-thread-list${chatsOpen ? " is-open" : ""}`} aria-label="AI threads">
                {/* Narrow drawers only: the list folds behind this bar. */}
                <div className="global-ai-thread-bar">
                  <button
                    type="button"
                    className="global-ai-thread-toggle"
                    aria-expanded={chatsOpen}
                    aria-controls={chatListId}
                    onClick={() => setChatsOpen((value) => !value)}
                  >
                    <MessagesSquare size={14} aria-hidden="true" />
                    <span className="global-ai-thread-toggle__label">Chats</span>
                    {chatCount > 0 && <span className="global-ai-thread-toggle__count">{chatCount}</span>}
                    <span className="global-ai-thread-toggle__current">{selectedThread?.title ?? "New chat"}</span>
                    <ChevronDown size={14} className="global-ai-thread-toggle__chevron" aria-hidden="true" />
                  </button>
                  <Tooltip content="New chat">
                    <button type="button" className="icon-btn global-ai-icon-btn" onClick={startNewThread} disabled={!canWrite} aria-label="New chat">
                      <Plus size={14} />
                    </button>
                  </Tooltip>
                </div>
                <div className="global-ai-thread-list__items" id={chatListId}>
                  {threadsLoading ? (
                    <ThreadListSkeleton />
                  ) : threadGroups.length === 0 ? (
                    <div className="global-ai-thread-list__empty">No chats yet</div>
                  ) : (
                    threadGroups.map((group) => (
                      <div key={group.id} className="global-ai-thread-group">
                        <div className="global-ai-thread-group__title">{group.title}</div>
                        {group.threads.map((thread) => (
                          <ThreadItem
                            key={thread._id}
                            thread={thread}
                            readOnly={!canWrite}
                            isActive={selectedThreadId === thread._id}
                            onSelect={() => onSelectThread(thread._id)}
                            onRename={(title) => handleRename(thread._id, title)}
                            onArchive={() => handleArchive(thread._id)}
                            onDelete={() => handleDelete(thread._id)}
                          />
                        ))}
                      </div>
                    ))
                  )}
                </div>
                <button type="button" className="global-ai-thread-new" onClick={startNewThread} disabled={!canWrite}>
                  <Plus size={13} /> New chat
                </button>
              </section>

              <section className="global-ai-main" aria-label="AI conversation">
                <div className="global-ai-messages" ref={scrollerRef} onScroll={onScrollerScroll}>
                  {messagesLoading ? (
                    <MessagesSkeleton />
                  ) : !hasMessages ? (
                    <div className="global-ai-empty">
                      <div className="global-ai-empty__title">What can I help you with?</div>
                      {emptyHint && <p className="global-ai-empty__hint">{emptyHint}</p>}
                      <div className="global-ai-empty__prompts">
                        {suggestions.map((prompt) => {
                          const Icon = prompt.icon;
                          return (
                            <button
                              key={prompt.id}
                              type="button"
                              className="global-ai-suggested-prompt"
                              onClick={() => applySuggestedPrompt(prompt)}
                            >
                              <Icon size={13} />
                              <span>{prompt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    (canWrite ? messages ?? [] : []).map((message) => (
                      <GlobalAiMessage
                        key={message._id}
                        message={message}
                        proposals={{
                          settled: settledProposalIds,
                          settlingId: settlingProposalId,
                          onApprove: (proposal) => void settleProposal(proposal, "approve"),
                          onDismiss: (proposal) => void settleProposal(proposal, "dismiss"),
                        }}
                      />
                    ))
                  )}
                  {canWrite && pendingQuestion && (
                    <GlobalAiMessage message={{ _id: "pending-question", role: "user", content: pendingQuestion }} />
                  )}
                  {canWrite && (streamingText || liveToolRecords.length > 0) && (
                    <GlobalAiMessage
                      message={{
                        _id: "streaming",
                        role: "assistant",
                        content: streamingText,
                        status: "streaming",
                      }}
                      liveToolRecords={liveToolRecords}
                    />
                  )}
                  {busy && !streamingText && hasMessages && (
                    <ShimmerLine label={liveToolRecords.some((record) => record.status === "running") ? "Looking up records" : "Thinking"} />
                  )}
                  {canWrite && pendingDraftsForThread.length > 0 && (
                    <div className="global-ai-drafts">
                      {pendingDraftsForThread.map((draft) => (
                        <ToolDraftCard
                          key={draft._id}
                          draft={draft}
                          onApprove={() => handleApproveDraft(draft._id)}
                          onReject={() => handleRejectDraft(draft._id)}
                        />
                      ))}
                    </div>
                  )}
                  {lastError && <ErrorBanner message={lastError} onRetry={() => submit()} onDismiss={() => setLastError(null)} />}
                </div>

                {showScrollToBottom && (
                  <button type="button" className="global-ai-scroll-bottom" onClick={scrollToBottom} aria-label="Scroll to latest message">
                    <ArrowDown size={13} /> Latest
                  </button>
                )}

                <form className="global-ai-composer" onSubmit={submit}>
                  {!canWrite && <p className="muted" role="status">Private AI conversations require current AI chat write permission and belong to their creator.</p>}
                  {deviceChat && (
                    <p className="muted" role="status">
                      Replies come from {deviceModel} at the address in Settings.
                      {capabilities.toolsAvailable
                        ? " It looks up records you can see, here on this device; what it reads goes only to that address."
                        : " This model cannot see or change workspace records; paste or attach what it needs."}
                      {!capabilities.toolsAvailable && deviceAi.config.assistantTools.lookUpRecords && deviceToolSupport === "unsupported" && (
                        <> {deviceModel} doesn't accept tools, so it can't look anything up. Settings suggests models that do.</>
                      )}
                    </p>
                  )}
                  {localOnly && !deviceChat && (
                    <p className="muted" role="status">
                      Live AI requires a connected workspace or an on-device model. Saved conversations remain available locally. Typed drafts stay on this device; selected files must be attached again after reload.
                      {deviceAi.supported && canReadSettings && <> <Link to={DEVICE_AI_SETTINGS_HREF} onClick={() => setOpen(false)}>Set up on-device AI in Settings</Link></>}
                    </p>
                  )}
                  {isStaticDemoRuntime() && <p className="muted" role="status">Demo replies are simulated; no AI provider is contacted.</p>}
                  <ContextChipRow context={browsingContext} />
                  {filesLoading && <p className="muted" role="status">Reading text files on this device…</p>}
                  {canWrite && attachedFiles.length > 0 && <p className="muted" role="status">Sending includes extracted file contents for the configured AI provider and saves selected text in this workspace’s chat history. Review the text below before sending.</p>}
                  {canWrite && attachedFiles.length > 0 && (
                    <div className="global-ai-files">
                      {attachedFiles.map((file, index) => (
                        <span key={`${file.name}-${index}`} className="global-ai-file-chip">
                          <Paperclip size={11} />
                          <span className="global-ai-file-chip__name">{file.name}</span>
                          <span className="global-ai-file-chip__size">{formatBytes(new TextEncoder().encode(file.text).byteLength)}</span>
                          <button
                            type="button"
                            className="global-ai-file-chip__remove"
                            aria-label={`Remove ${file.name}`}
                            disabled={busy || filesLoading}
                            onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== index))}
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {canWrite && attachedFiles.map((file, index) => <details key={`preview-${index}`}><summary>Review extracted text: {file.name}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "10rem", overflow: "auto" }}>{file.text}</pre></details>)}
                  <div className="global-ai-composer__box">
                    <textarea
                      ref={composerRef}
                      data-autofocus=""
                      readOnly={!canWrite || busy}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder={assistantPlaceholder(capabilities, deviceChat)}
                      rows={3}
                      onKeyDown={(event) => {
                        // Enter sends; Shift+Enter adds a line (IME composition is left alone).
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void submit();
                        }
                      }}
                    />
                    <div className="global-ai-composer__bar">
                      <div className="global-ai-composer__left">
                        <Tooltip content={<>Attach text files<br />{AI_ATTACHMENT_LIMITS}</>}>
                          <button
                            type="button"
                            className="global-ai-icon-btn"
                            aria-label="Attach text files"
                            aria-describedby="global-ai-attach-limits"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!canWrite || busy || filesLoading}
                          >
                            <Paperclip size={13} />
                          </button>
                        </Tooltip>
                        <span id="global-ai-attach-limits" className="sr-only">{AI_ATTACHMENT_LIMITS}</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept={AI_ATTACHMENT_ACCEPT}
                          hidden
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            void handleFilesPicked(event.target.files);
                            event.target.value = "";
                          }}
                        />
                        {!localOnly && (
                          <ModelSelector
                            value={currentModelId}
                            options={modelOptions}
                            onChange={setPickedModelId}
                            providerActive={providerActive}
                            locked={!canSend || isModelLocked}
                            providerLabel={effectiveProvider?.label}
                          />
                        )}
                      </div>
                      {deviceChat && busy ? (
                        <button
                          type="button"
                          className="global-ai-send"
                          onClick={stopOnDevice}
                          aria-label="Stop the reply"
                          title="Stop the reply; what it has written so far is kept"
                        >
                          <Square size={11} fill="currentColor" aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          className="global-ai-send"
                          disabled={!canSend || busy || filesLoading || !input.trim() || !society}
                          aria-label="Send message"
                          title="Send (⌘/Ctrl + Enter)"
                        >
                          {busy ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </section>
            </div>

            {isDraggingFile && (
              <div className="global-ai-dropzone" role="presentation">
                <div className="global-ai-dropzone__inner">
                  <Paperclip size={20} />
                  <strong>Drop files to attach</strong>
                  <span>Up to 8 files per message</span>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

type ProposalHandlers = {
  /** Proposal ids a later message approved or dismissed. */
  settled: ReadonlySet<string>;
  settlingId: string | null;
  onApprove: (proposal: DeviceToolRecord) => void;
  onDismiss: (proposal: DeviceToolRecord) => void;
};

function GlobalAiMessage({ message, proposals, liveToolRecords }: { message: any; proposals?: ProposalHandlers; liveToolRecords?: readonly DeviceToolRecord[] }) {
  const isAssistant = message.role === "assistant";
  const [copied, setCopied] = useState(false);
  const isStreaming = message.status === "streaming";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  const reasoning = message.parts?.reasoning ?? message.parts?.thinking;
  // On-device replies carry their own tool records (chips and proposals); hosted ones the tool-call cards.
  const deviceRecords = liveToolRecords ?? (message.parts?.provider === "on_device" ? parseDeviceToolRecords(message.toolCalls) : []);
  const toolCalls = deviceRecords.length ? [] : parseToolCalls(message.toolCalls);
  const openProposals = proposals ? deviceRecords.filter((record) => record.status === "proposed" && !proposals.settled.has(record.id)) : [];

  return (
    <article className={`global-ai-message ${isAssistant ? "global-ai-message--assistant" : "global-ai-message--user"}`}>
      {reasoning && <ReasoningPanel reasoning={reasoning} />}
      {toolCalls.length > 0 && (
        <div className="global-ai-tool-cards">
          {toolCalls.map((call, index) => (
            <ToolCallCard key={call.id ?? index} call={call} />
          ))}
        </div>
      )}
      {(message.content || !isAssistant) && (
        <div className="global-ai-message__content">
          {isAssistant ? (
            <MarkdownView text={message.content ?? ""} />
          ) : (
            <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
          )}
          {isStreaming && <span className="global-ai-cursor" />}
        </div>
      )}
      {deviceRecords.length > 0 && <DeviceToolActivity records={deviceRecords} />}
      {proposals && openProposals.length > 0 && (
        <div className="global-ai-drafts">
          {openProposals.map((proposal) => (
            <ToolDraftCard
              key={proposal.id}
              draft={{ toolName: findAgentTool(proposal.name)?.title ?? proposal.name, summary: proposal.summary, payload: parseJsonOrText(proposal.argsJson) }}
              note="Runs on this device as you when you approve. Nothing has changed yet."
              dismissLabel="Dismiss"
              busy={proposals.settlingId !== null}
              onApprove={() => proposals.onApprove(proposal)}
              onReject={() => proposals.onDismiss(proposal)}
            />
          ))}
        </div>
      )}
      {isAssistant && message.content && !isStreaming && (
        <div className="global-ai-message__footer">
          <button type="button" className="global-ai-message__copy" onClick={copy} aria-label="Copy message">
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </article>
  );
}

export function MarkdownView({ text }: { text: string }) {
  return (
    <div className="global-ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          img: ({ src, alt }) => src ? <a href={src} target="_blank" rel="noopener noreferrer">View image: {alt || "attached image"}</a> : <span>{alt || "Image unavailable"}</span>,
          table: MarkdownTable,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ReasoningPanel({ reasoning }: { reasoning: any }) {
  const [open, setOpen] = useState(false);
  const text = typeof reasoning === "string" ? reasoning : JSON.stringify(reasoning, null, 2);
  return (
    <div className={`global-ai-reasoning${open ? " is-open" : ""}`}>
      <button type="button" className="global-ai-reasoning__head" onClick={() => setOpen((value) => !value)}>
        <ChevronDown size={12} className="global-ai-reasoning__chev" />
        <Sparkles size={11} />
        <span>Reasoning</span>
      </button>
      {open && <pre className="global-ai-reasoning__body">{text}</pre>}
    </div>
  );
}

type ToolCallShape = {
  id?: string;
  name?: string;
  args?: any;
  result?: any;
  status?: string;
};

function parseToolCalls(input: any): ToolCallShape[] {
  if (!input) return [];
  if (Array.isArray(input)) return input as ToolCallShape[];
  if (typeof input === "object") {
    if (Array.isArray(input.calls)) return input.calls;
    return [input];
  }
  return [];
}

function ToolCallCard({ call }: { call: ToolCallShape }) {
  const [open, setOpen] = useState(false);
  const name = call.name ?? "tool";
  const status = call.status ?? (call.result ? "complete" : "pending");
  return (
    <div className={`global-ai-toolcall global-ai-toolcall--${status}`}>
      <button type="button" className="global-ai-toolcall__head" onClick={() => setOpen((value) => !value)}>
        <ChevronDown size={12} className={`global-ai-toolcall__chev${open ? " is-open" : ""}`} />
        <Wrench size={11} />
        <span className="global-ai-toolcall__name">{name}</span>
        <span className="global-ai-toolcall__status">{status}</span>
      </button>
      {open && (
        <div className="global-ai-toolcall__body">
          {call.args !== undefined && (
            <div className="global-ai-toolcall__section">
              <div className="global-ai-toolcall__label">Arguments</div>
              <pre>{JSON.stringify(call.args, null, 2)}</pre>
            </div>
          )}
          {call.result !== undefined && (
            <div className="global-ai-toolcall__section">
              <div className="global-ai-toolcall__label">Result</div>
              <pre>{typeof call.result === "string" ? call.result : JSON.stringify(call.result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function ToolDraftCard({
  draft,
  note,
  dismissLabel = "Discard",
  busy = false,
  onApprove,
  onReject,
}: {
  draft: any;
  /** A line under the summary, e.g. where the change runs. */
  note?: string;
  dismissLabel?: string;
  /** Approve or dismiss is in progress. */
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="global-ai-draft">
      <div className="global-ai-draft__head">
        <Wrench size={12} />
        <strong>{draft.toolName ?? "Draft action"}</strong>
        <span className="global-ai-draft__pill">awaiting approval</span>
      </div>
      {draft.summary && <div className="global-ai-draft__summary">{draft.summary}</div>}
      {note && <div className="global-ai-draft__note">{note}</div>}
      {draft.payload && (
        <pre className="global-ai-draft__payload">{JSON.stringify(draft.payload, null, 2)}</pre>
      )}
      <div className="global-ai-draft__actions">
        <button type="button" className="global-ai-draft__btn global-ai-draft__btn--ghost" onClick={onReject} disabled={busy}>
          <X size={11} /> {dismissLabel}
        </button>
        <button type="button" className="global-ai-draft__btn global-ai-draft__btn--accent" onClick={onApprove} disabled={busy}>
          {busy ? <Loader2 size={11} className="spin" /> : <Check size={11} />} Approve
        </button>
      </div>
    </div>
  );
}

function ThreadItem({
  thread,
  readOnly = false,
  isActive,
  onSelect,
  onRename,
  onArchive,
  onDelete,
}: {
  thread: any;
  readOnly?: boolean;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(thread.title ?? "");
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const commit = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== thread.title) onRename(next);
  };

  const cancelRename = () => {
    setRenaming(false);
    setDraft(thread.title ?? "");
  };

  return (
    <div
      className={`global-ai-thread${isActive ? " is-active" : ""}${menuOpen ? " has-menu" : ""}`}
      onClick={() => !renaming && onSelect()}
      role="button"
      tabIndex={0}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!renaming && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="global-ai-thread__icon"><Sparkles size={12} /></span>
      {renaming ? (
        <input
          autoFocus
          className="global-ai-thread__rename"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelRename();
            }
          }}
        />
      ) : (
        <span className="global-ai-thread__title">{thread.title}</span>
      )}
      <div className="global-ai-thread__menu" ref={menuRef}>
        <button
          type="button"
          className="global-ai-thread__menu-trigger"
          aria-label="Thread actions"
          disabled={readOnly}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
        >
          <MoreHorizontal size={12} />
        </button>
        {!readOnly && menuOpen && (
          <div className="global-ai-thread__menu-pop" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setRenaming(true);
                setDraft(thread.title ?? "");
              }}
            >
              <Pencil size={11} /> Rename
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onArchive();
              }}
            >
              <FileText size={11} /> Archive
            </button>
            <button
              type="button"
              className="global-ai-thread__menu-danger"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ContextChipRow({ context }: { context: any }) {
  const chips: { icon: ReactNode; label: string; title?: string }[] = [];
  if (context.society?.name) {
    chips.push({
      icon: <Building2 size={11} />,
      label: context.society.name,
      title: context.society.incorporationNumber ? `IN ${context.society.incorporationNumber}` : undefined,
    });
  }
  chips.push({ icon: <MapPin size={11} />, label: context.label, title: context.route });
  if (context.recordId) {
    chips.push({
      icon: <FileText size={11} />,
      label: `Record · ${context.recordId.slice(0, 8)}`,
      title: context.recordId,
    });
  }
  return (
    <div className="global-ai-composer__context">
      {chips.map((chip, index) => (
        <span key={index} className="global-ai-context-chip" title={chip.title}>
          {chip.icon}
          <span>{chip.label}</span>
        </span>
      ))}
    </div>
  );
}

function ModelSelector({
  value,
  options,
  onChange,
  providerActive,
  locked,
  providerLabel,
}: {
  value: string | undefined;
  options: ModelOption[];
  onChange: (next: string) => void;
  providerActive: boolean;
  locked: boolean;
  providerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = options.find((model) => model.id === value);
  const displayLabel = selected?.label ?? value ?? (providerActive ? providerLabel ?? "Default model" : "No provider");

  return (
    <div className={`global-ai-model${locked ? " is-locked" : ""}`} ref={ref}>
      <button
        type="button"
        className="global-ai-model__btn"
        onClick={() => !locked && setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={locked}
        title={locked ? "Model is locked for this thread" : "Pick a model for new chats"}
      >
        <span className={`global-ai-model__dot${providerActive ? " is-on" : ""}`} />
        <span className="global-ai-model__label">{displayLabel}</span>
        {!locked && <ChevronDown size={11} />}
      </button>
      {open && !locked && (
        <div className="global-ai-model__pop" role="listbox">
          {options.length === 0 ? (
            <div className="global-ai-model__empty">No models available</div>
          ) : (
            options.map((model) => (
              <button
                key={model.id}
                type="button"
                className={`global-ai-model__item${model.id === value ? " is-selected" : ""}`}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
                role="option"
                aria-selected={model.id === value}
              >
                <div className="global-ai-model__item-label">{model.label}</div>
                <div className="global-ai-model__item-provider">{model.provider}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function normalizeCatalog(raw: any, providerHint?: string): ModelOption[] {
  if (!raw) return [];
  const items: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.models)
      ? raw.models
      : Array.isArray(raw.data)
        ? raw.data
        : [];
  const provider = providerHint ?? "provider";
  const seen = new Set<string>();
  const out: ModelOption[] = [];
  for (const item of items) {
    const id = typeof item === "string"
      ? item
      : item?.id ?? item?.value ?? item?.name;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = item?.label ?? item?.name ?? id;
    out.push({ id, label, provider });
    if (out.length >= 200) break;
  }
  return out;
}

function ShimmerLine({ label }: { label: string }) {
  return (
    <div className="global-ai-shimmer" role="status">
      <span className="global-ai-shimmer__text">{label}</span>
    </div>
  );
}

function ThreadListSkeleton() {
  return (
    <div className="global-ai-thread-skel">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="global-ai-thread-skel__row">
          <Skeleton variant="circle" width="18px" height="18px" />
          <Skeleton variant="line" width="100%" height="10px" />
        </div>
      ))}
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="global-ai-msg-skel">
      <Skeleton variant="line" width="50%" height="10px" />
      <Skeleton variant="line" width="80%" height="10px" />
      <Skeleton variant="line" width="65%" height="10px" />
      <div style={{ height: 12 }} />
      <Skeleton variant="line" width="40%" height="10px" />
      <Skeleton variant="line" width="72%" height="10px" />
    </div>
  );
}

type ErrorKind = "rate_limit" | "no_credits" | "no_key" | "network" | "unknown";

function classifyError(message: string): ErrorKind {
  const lower = message.toLowerCase();
  if (/\brate[ -]?limit(?:ed)?\b/.test(lower) || lower.includes("429")) return "rate_limit";
  if (lower.includes("credit") || lower.includes("quota") || lower.includes("billing")) return "no_credits";
  if (lower.includes("api key") || lower.includes("not configured") || lower.includes("provider")) return "no_key";
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("connection")) return "network";
  return "unknown";
}

function ErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const kind = classifyError(message);
  const config: Record<ErrorKind, { icon: ReactNode; title: string; hint?: string }> = {
    rate_limit: { icon: <AlertTriangle size={13} />, title: "Rate limited", hint: "Try again in a moment." },
    no_credits: { icon: <KeyRound size={13} />, title: "Out of credits", hint: "Top up your provider account." },
    no_key: { icon: <KeyRound size={13} />, title: "Provider not configured", hint: "Open AI settings to add a key." },
    network: { icon: <AlertTriangle size={13} />, title: "Connection issue", hint: "Check your network and retry." },
    unknown: { icon: <AlertTriangle size={13} />, title: "Couldn't send message" },
  };
  const cfg = config[kind];
  return (
    <div className={`global-ai-error global-ai-error--${kind}`} role="alert">
      <div className="global-ai-error__icon">{cfg.icon}</div>
      <div className="global-ai-error__body">
        <strong>{cfg.title}</strong>
        <span>{message}</span>
        {cfg.hint && <span>{cfg.hint}</span>}
      </div>
      <div className="global-ai-error__actions">
        <button type="button" onClick={onRetry}>Retry</button>
        <button type="button" className="global-ai-error__dismiss" onClick={onDismiss} aria-label="Dismiss">
          <X size={11} />
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ThreadGroup = { id: string; title: string; threads: any[] };

function groupThreadsByDate(threads: any[]): ThreadGroup[] {
  if (threads.length === 0) return [];
  const now = new Date();
  const startOfToday = startOfDay(now);
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const startOfLastWeek = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfLastMonth = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60 * 1000);
  const buckets: Record<string, any[]> = {
    today: [],
    yesterday: [],
    last_7: [],
    last_30: [],
    older: [],
  };
  for (const thread of threads) {
    if (thread.status === "archived") continue;
    const ts = new Date(thread.lastMessageAtISO ?? thread.updatedAtISO ?? thread.createdAtISO ?? Date.now());
    if (ts >= startOfToday) buckets.today.push(thread);
    else if (ts >= startOfYesterday) buckets.yesterday.push(thread);
    else if (ts >= startOfLastWeek) buckets.last_7.push(thread);
    else if (ts >= startOfLastMonth) buckets.last_30.push(thread);
    else buckets.older.push(thread);
  }
  const groups: ThreadGroup[] = [
    { id: "today", title: "Today", threads: buckets.today },
    { id: "yesterday", title: "Yesterday", threads: buckets.yesterday },
    { id: "last_7", title: "Previous 7 days", threads: buckets.last_7 },
    { id: "last_30", title: "Previous 30 days", threads: buckets.last_30 },
    { id: "older", title: "Older", threads: buckets.older },
  ];
  return groups.filter((group) => group.threads.length > 0);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
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
