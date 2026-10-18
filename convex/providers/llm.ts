// LLM adapter: produces structured meeting minutes from a transcript.
//
// The prompt, the rule-based fallback and reply parsing live in
// shared/ai/minutesDraft.ts so the on-device client drafts the same way. This
// file only chooses an endpoint and speaks HTTP.
//
// Endpoint order: the workspace's saved AI provider (AI setup), then the
// deployment environment (ANTHROPIC_API_KEY / OPENAI_API_KEY), then the
// rule-based draft. A workspace-supplied base URL goes through the outbound
// URL policy (public HTTPS only) and provider error bodies are never surfaced.
import { api, internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import {
  buildMinutesDraftMessages,
  heuristicMinutesDraft,
  MINUTES_DRAFT_JSON_SCHEMA,
  MINUTES_DRAFT_SYSTEM_PROMPT,
  minutesDraftUserPrompt,
  parseJsonObject,
  normalizeDraft,
  type MinuteDraft,
  type MinutesDraftInput,
} from "../../shared/ai/minutesDraft";
import {
  chatCompletionBody,
  chatCompletionContent,
  isResponseFormatRejection,
  type JsonMode,
} from "../../shared/ai/openAiCompatible";
import { aiProviderErrorMessage, aiProviderStatusMessage } from "../../shared/ai/providerErrors";
import { normalizeAiBaseUrl } from "../../shared/ai/endpointPolicy";
import { isHostedAiUrlAllowed } from "../lib/aiEndpointPolicy";
import { fetchConvexOutbound } from "../lib/outboundUrlPolicy";
import { providers } from "./env";

export type { MinuteDraft } from "../../shared/ai/minutesDraft";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MODEL_TIMEOUT_MS = 120_000;

/** A chat-completions endpoint the server may call for a minutes draft. */
export type MinutesModelEndpoint =
  | {
      kind: "openai-compatible";
      /** Full `/chat/completions` URL. */
      url: string;
      apiKey: string;
      model: string;
      source: "workspace" | "environment";
      jsonModes: readonly JsonMode[];
    }
  | { kind: "anthropic"; url: string; apiKey: string; model: string; source: "environment" };

function env(name: string): string | undefined {
  try {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  } catch {
    return undefined;
  }
}

function environmentEndpoint(): MinutesModelEndpoint | null {
  const provider = providers.llm();
  if (provider.id === "anthropic") {
    return {
      kind: "anthropic",
      url: env("ANTHROPIC_API_BASE_URL") ?? "https://api.anthropic.com/v1/messages",
      apiKey: env("ANTHROPIC_API_KEY") ?? "",
      model: env("ANTHROPIC_MINUTES_MODEL") ?? env("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest",
      source: "environment",
    };
  }
  if (provider.id === "openai") {
    return {
      kind: "openai-compatible",
      url: env("OPENAI_API_BASE_URL") ?? `${OPENAI_BASE_URL}/chat/completions`,
      apiKey: env("OPENAI_API_KEY") ?? "",
      model: env("OPENAI_MINUTES_MODEL") ?? env("OPENAI_MODEL") ?? "gpt-4o-mini",
      source: "environment",
      jsonModes: ["json_object", "none"],
    };
  }
  return null;
}

type SavedProvider = { provider?: unknown; baseUrl?: unknown; modelId?: unknown; status?: unknown; scope?: unknown; secretVaultItemId?: unknown };

/**
 * The workspace's saved provider, if it is active and has a key. Personal
 * settings are not used: minutes are workspace records.
 */
async function workspaceEndpoint(ctx: Pick<ActionCtx, "runQuery">, societyId: string): Promise<MinutesModelEndpoint | null> {
  let effective: SavedProvider | null = null;
  try {
    const settings: { effective?: SavedProvider | null } | null = await ctx.runQuery(api.aiSettings.getEffective, { societyId });
    effective = settings?.effective ?? null;
  } catch {
    return null;
  }
  if (!effective || effective.status !== "active" || effective.scope !== "workspace" || typeof effective.secretVaultItemId !== "string") return null;
  let apiKey = "";
  try {
    const secret: { value?: unknown } | null = await ctx.runQuery(internal.secrets._revealForServer, { id: effective.secretVaultItemId, societyId });
    apiKey = typeof secret?.value === "string" ? secret.value : "";
  } catch {
    return null;
  }
  if (!apiKey) return null;
  const provider = effective.provider === "openrouter" || effective.provider === "openai-compatible" ? effective.provider : "openai";
  const savedBase = typeof effective.baseUrl === "string" && effective.baseUrl.trim() ? effective.baseUrl : "";
  const baseUrl = normalizeAiBaseUrl(savedBase || (provider === "openrouter" ? OPENROUTER_BASE_URL : OPENAI_BASE_URL));
  const url = `${baseUrl}/chat/completions`;
  if (!isHostedAiUrlAllowed(url, "minutes_draft")) {
    console.warn("[minutes-llm] workspace AI provider address rejected by the outbound URL policy");
    return null;
  }
  const model = typeof effective.modelId === "string" && effective.modelId.trim()
    ? effective.modelId.trim()
    : provider === "openrouter" ? "openai/gpt-4.1-mini" : "gpt-4.1-mini";
  return {
    kind: "openai-compatible",
    url,
    apiKey,
    model,
    source: "workspace",
    jsonModes: provider === "openai-compatible" ? ["json_schema", "json_object", "none"] : ["json_object", "none"],
  };
}

/** Saved workspace provider first, then the deployment environment. */
export async function resolveMinutesEndpoint(ctx: Pick<ActionCtx, "runQuery">, societyId: string): Promise<MinutesModelEndpoint | null> {
  return (await workspaceEndpoint(ctx, societyId)) ?? environmentEndpoint();
}

class ProviderStatusError extends Error {
  constructor(readonly status: number) {
    super(aiProviderStatusMessage(status));
  }
}

async function postJson(endpoint: MinutesModelEndpoint, headers: Record<string, string>, body: unknown) {
  const init = { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) };
  if (endpoint.source === "workspace") {
    // Workspace-supplied address: policy-checked on every redirect hop.
    const response = await fetchConvexOutbound(endpoint.url, init, {
      source: "tenant",
      operation: "minutes_draft",
      timeoutMs: MODEL_TIMEOUT_MS,
      maxResponseBytes: 4_000_000,
      maxRedirects: 0,
    });
    return { ok: response.ok, status: response.status, text: response.text };
  }
  const response = await fetch(endpoint.url, init);
  return { ok: response.ok, status: response.status, text: await response.text().catch(() => "") };
}

async function openAiCompatibleDraft(endpoint: Extract<MinutesModelEndpoint, { kind: "openai-compatible" }>, input: MinutesDraftInput): Promise<string> {
  const messages = buildMinutesDraftMessages(input);
  let lastStatus = 0;
  for (const jsonMode of endpoint.jsonModes) {
    const response = await postJson(endpoint, { authorization: `Bearer ${endpoint.apiKey}` }, chatCompletionBody({
      model: endpoint.model,
      messages,
      jsonMode,
      jsonSchema: MINUTES_DRAFT_JSON_SCHEMA,
    }));
    if (response.ok) {
      let payload: unknown;
      try {
        payload = JSON.parse(response.text);
      } catch {
        throw new Error("The AI provider returned an unreadable reply.");
      }
      const content = chatCompletionContent(payload);
      if (!content?.trim()) throw new Error("The AI provider returned an empty minutes draft.");
      return content;
    }
    lastStatus = response.status;
    if (!isResponseFormatRejection(response.status, response.text)) break;
  }
  throw new ProviderStatusError(lastStatus);
}

async function anthropicDraft(endpoint: Extract<MinutesModelEndpoint, { kind: "anthropic" }>, input: MinutesDraftInput): Promise<string> {
  const response = await postJson(endpoint, { "x-api-key": endpoint.apiKey, "anthropic-version": "2023-06-01" }, {
    model: endpoint.model,
    max_tokens: 1800,
    temperature: 0.2,
    system: MINUTES_DRAFT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: minutesDraftUserPrompt(input) }],
  });
  if (!response.ok) throw new ProviderStatusError(response.status);
  let payload: unknown;
  try {
    payload = JSON.parse(response.text);
  } catch {
    throw new Error("The AI provider returned an unreadable reply.");
  }
  const blocks = payload && typeof payload === "object" ? (payload as { content?: unknown }).content : undefined;
  const content = Array.isArray(blocks)
    ? blocks
        .map((block) => (block && typeof block === "object" && (block as { type?: unknown }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
        .join("\n")
        .trim()
    : "";
  if (!content) throw new Error("The AI provider returned an empty minutes draft.");
  return content;
}

/**
 * Drafts minutes for a transcript. Pass the endpoint from
 * `resolveMinutesEndpoint`; without one (or on any provider failure) the
 * rule-based draft is returned so drafting never hard-fails.
 */
export async function summarizeMinutes(
  args: MinutesDraftInput,
  endpoint: MinutesModelEndpoint | null = environmentEndpoint(),
): Promise<MinuteDraft> {
  const fallback = heuristicMinutesDraft(args);
  if (!endpoint) return fallback;
  try {
    const text = endpoint.kind === "anthropic" ? await anthropicDraft(endpoint, args) : await openAiCompatibleDraft(endpoint, args);
    const raw = parseJsonObject(text);
    if (raw === undefined) throw new Error("The AI provider's minutes draft was not JSON.");
    return normalizeDraft(raw, fallback);
  } catch (error) {
    console.error("[minutes-llm] falling back to the rule-based draft:", aiProviderErrorMessage(error), endpoint.source);
    return fallback;
  }
}
