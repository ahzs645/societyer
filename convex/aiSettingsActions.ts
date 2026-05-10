"use node";

import { v } from "convex/values";
import { action } from "./lib/untypedServer";
import { api, internal } from "./_generated/api";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const RECOMMENDED_OPENROUTER_MODELS = [
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1",
  "anthropic/claude-sonnet-4",
  "google/gemini-2.5-pro",
  "meta-llama/llama-3.1-70b-instruct",
];

export const validateProviderKey = action({
  args: {
    provider: v.string(),
    apiKey: v.string(),
    baseUrl: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const provider = normalizeProvider(args.provider);
    const apiKey = args.apiKey.trim();
    if (!apiKey) return { ok: false, message: "API key is required." };
    const baseUrl = normalizeBaseUrl(args.baseUrl, provider);
    try {
      const response = await fetchModels(baseUrl, apiKey);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          message: payload?.error?.message ?? payload?.message ?? `Provider returned ${response.status}.`,
        };
      }
      const modelIds = Array.isArray(payload?.data)
        ? payload.data.map((model: any) => model?.id).filter(Boolean).slice(0, 30)
        : [];
      const modelCatalog = normalizeModels(provider, payload?.data ?? []);
      if (modelCatalog.models.length > 0) {
        await writeModelCache(ctx, provider, cacheKeyFor(provider, baseUrl), modelCatalog);
      }
      return {
        ok: true,
        provider,
        baseUrl,
        message: `Validated ${providerLabel(provider)} key.`,
        modelIds,
        modelCatalog,
      };
    } catch (error: any) {
      return {
        ok: false,
        provider,
        baseUrl,
        message: error?.message ?? "Could not reach provider.",
      };
    }
  },
});

export const listProviderModels = action({
  args: {
    provider: v.string(),
    apiKey: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
    societyId: v.optional(v.id("societies")),
    actingUserId: v.optional(v.id("users")),
    forceRefresh: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const provider = normalizeProvider(args.provider);
    const baseUrl = normalizeBaseUrl(args.baseUrl, provider);
    const cacheKey = cacheKeyFor(provider, baseUrl);
    const cached = await readModelCache(ctx, provider, cacheKey);
    if (!args.forceRefresh && cached && Date.parse(cached.expiresAtISO) > Date.now()) {
      return { ...cached.models, cached: true, stale: false };
    }

    const apiKey = args.apiKey?.trim() || await savedApiKey(ctx, args.societyId, args.actingUserId);
    if (!apiKey) {
      if (cached) return { ...cached.models, cached: true, stale: true };
      return fallbackCatalog(provider, "Add or save an API key to refresh the live model list.");
    }

    try {
      const response = await fetchModels(baseUrl, apiKey);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (cached) return { ...cached.models, cached: true, stale: true, message: providerError(payload, response.status) };
        return fallbackCatalog(provider, providerError(payload, response.status));
      }
      const modelCatalog = normalizeModels(provider, payload?.data ?? []);
      await writeModelCache(ctx, provider, cacheKey, modelCatalog);
      return { ...modelCatalog, cached: false, stale: false };
    } catch (error: any) {
      if (cached) return { ...cached.models, cached: true, stale: true, message: error?.message ?? "Could not reach provider." };
      return fallbackCatalog(provider, error?.message ?? "Could not reach provider.");
    }
  },
});

function normalizeProvider(provider: string) {
  const value = provider.trim().toLowerCase();
  if (value === "openrouter") return "openrouter";
  return value === "openai-compatible" ? "openai-compatible" : "openai";
}

function normalizeBaseUrl(baseUrl: string | undefined, provider: string) {
  const raw = baseUrl?.trim() || (provider === "openrouter" ? OPENROUTER_BASE_URL : provider === "openai" ? OPENAI_BASE_URL : "");
  return raw.replace(/\/+$/, "");
}

function providerLabel(provider: string) {
  if (provider === "openrouter") return "OpenRouter";
  return provider === "openai-compatible" ? "OpenAI-compatible" : "OpenAI";
}

function fetchModels(baseUrl: string, apiKey: string) {
  return fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
  });
}

function providerError(payload: any, status: number) {
  return payload?.error?.message ?? payload?.message ?? `Provider returned ${status}.`;
}

function cacheKeyFor(provider: string, baseUrl: string) {
  return `${provider}:${baseUrl || "default"}`;
}

async function readModelCache(ctx: any, provider: string, cacheKey: string) {
  return ctx.runQuery((internal as any).aiSettings._getModelCatalogCache, { provider, cacheKey }).catch(() => null);
}

async function writeModelCache(ctx: any, provider: string, cacheKey: string, modelCatalog: any) {
  const fetchedAt = new Date();
  await ctx.runMutation((internal as any).aiSettings._upsertModelCatalogCache, {
    provider,
    cacheKey,
    models: modelCatalog,
    fetchedAtISO: fetchedAt.toISOString(),
    expiresAtISO: new Date(fetchedAt.getTime() + MODEL_CACHE_TTL_MS).toISOString(),
  }).catch(() => null);
}

async function savedApiKey(ctx: any, societyId?: any, actingUserId?: any) {
  if (!societyId) return "";
  const settings = await ctx.runQuery((api as any).aiSettings.getEffective, { societyId, actingUserId }).catch(() => null);
  const effective = settings?.effective;
  if (!effective?.secretVaultItemId) return "";
  const secret = await ctx.runQuery((internal as any).secrets._revealForServer, { id: effective.secretVaultItemId }).catch(() => null);
  return secret?.value ?? "";
}

function normalizeModels(provider: string, rawModels: any[]) {
  const models = rawModels
    .map((model) => normalizeModel(provider, model))
    .filter((model) => model.id)
    .sort((left, right) => sortModel(left) - sortModel(right) || left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name));
  const textModels = models.filter((model) => model.outputModalities.includes("text") || model.outputModalities.length === 0);
  const categories = {
    recommended: textModels.filter((model) => RECOMMENDED_OPENROUTER_MODELS.includes(model.id)).slice(0, 12),
    fastCheap: textModels.filter((model) => model.isFree || priceNumber(model.promptPrice) <= 0.000001).slice(0, 40),
    reasoning: textModels.filter((model) => matches(model, ["reason", "o3", "o4", "thinking", "deepseek-r1", "gemini-2.5-pro"])).slice(0, 40),
    coding: textModels.filter((model) => matches(model, ["code", "coder", "claude", "gpt-4.1", "deepseek", "qwen"])).slice(0, 40),
    vision: textModels.filter((model) => model.supportsVision).slice(0, 40),
    free: textModels.filter((model) => model.isFree).slice(0, 80),
    tools: textModels.filter((model) => model.supportsTools).slice(0, 80),
    all: textModels,
  };
  return {
    provider,
    fetchedAtISO: new Date().toISOString(),
    recommendedIds: RECOMMENDED_OPENROUTER_MODELS,
    models: textModels,
    categories,
  };
}

function normalizeModel(provider: string, model: any) {
  const id = String(model?.id ?? "");
  const providerName = id.includes("/") ? id.split("/")[0] : providerLabel(provider);
  const inputModalities = stringArray(model?.architecture?.input_modalities);
  const outputModalities = stringArray(model?.architecture?.output_modalities);
  const supportedParameters = stringArray(model?.supported_parameters);
  const promptPrice = model?.pricing?.prompt ?? "";
  const completionPrice = model?.pricing?.completion ?? "";
  return {
    id,
    name: String(model?.name ?? id),
    provider: providerName,
    contextLength: Number(model?.context_length ?? 0) || undefined,
    promptPrice,
    completionPrice,
    inputModalities,
    outputModalities,
    supportedParameters,
    supportsTools: supportedParameters.includes("tools") || supportedParameters.includes("tool_choice"),
    supportsVision: inputModalities.includes("image"),
    supportsStructuredOutputs: supportedParameters.includes("response_format") || supportedParameters.includes("structured_outputs"),
    isFree: id.endsWith(":free") || priceNumber(promptPrice) === 0 && priceNumber(completionPrice) === 0,
  };
}

function fallbackCatalog(provider: string, message: string) {
  const models = provider === "openrouter"
    ? RECOMMENDED_OPENROUTER_MODELS.map((id) => ({
        id,
        name: id.split("/").pop()?.replace(/-/g, " ") ?? id,
        provider: id.split("/")[0],
        contextLength: undefined,
        promptPrice: "",
        completionPrice: "",
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportedParameters: [],
        supportsTools: false,
        supportsVision: false,
        supportsStructuredOutputs: false,
        isFree: false,
      }))
    : [];
  return {
    provider,
    message,
    cached: false,
    stale: false,
    recommendedIds: RECOMMENDED_OPENROUTER_MODELS,
    models,
    categories: {
      recommended: models,
      fastCheap: [],
      reasoning: [],
      coding: [],
      vision: [],
      free: [],
      tools: [],
      all: models,
    },
  };
}

function stringArray(value: any) {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

function priceNumber(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function matches(model: any, fragments: string[]) {
  const haystack = `${model.id} ${model.name}`.toLowerCase();
  return fragments.some((fragment) => haystack.includes(fragment));
}

function sortModel(model: any) {
  if (RECOMMENDED_OPENROUTER_MODELS.includes(model.id)) return 0;
  if (model.supportsTools) return 1;
  if (model.isFree) return 2;
  return 3;
}
