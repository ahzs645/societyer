"use node";

import { v } from "convex/values";
import { action } from "./lib/untypedServer";
import { api, internal } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

function env(name: string): string | undefined {
  return process.env[name];
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const sendChatMessage = action({
  args: {
    societyId: v.id("societies"),
    threadId: v.optional(v.id("aiChatThreads")),
    content: v.string(),
    actingUserId: v.optional(v.id("users")),
    browsingContext: v.optional(v.any()),
    modelId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const runtimeConfig = await resolveAiRuntimeConfig(ctx, args.societyId, args.actingUserId, args.modelId);
    const modelId = runtimeConfig.modelId;
    const threadId =
      args.threadId ??
      (await ctx.runMutation((api as any).aiChat.createThread, {
        societyId: args.societyId,
        title: args.content,
        modelId,
        browsingContext: args.browsingContext,
        actingUserId: args.actingUserId,
      }));

    await ctx.runMutation((internal as any).aiChat._appendMessage, {
      societyId: args.societyId,
      threadId,
      role: "user",
      content: args.content,
      createdByUserId: args.actingUserId,
    });

    const [context, history] = await Promise.all([
      ctx.runQuery((api as any).aiAgents.getChatContext, {
        societyId: args.societyId,
        actingUserId: args.actingUserId,
        browsingContext: args.browsingContext,
      }),
      ctx.runQuery((api as any).aiChat.messagesForThread, { threadId }),
    ]);

    const tools = {
      load_skills: tool({
        description: "Load Societyer skill instructions by name before using domain tools.",
        inputSchema: z.object({ skillNames: z.array(z.string()) }),
        execute: async ({ skillNames }: { skillNames: string[] }) =>
          ctx.runQuery((api as any).aiAgents.loadSkills, {
            societyId: args.societyId,
            skillNames,
          }),
      }),
      learn_tools: tool({
        description: "Fetch exact schemas for Societyer tools before executing them.",
        inputSchema: z.object({ toolNames: z.array(z.string()) }),
        execute: async ({ toolNames }: { toolNames: string[] }) =>
          ctx.runQuery((api as any).aiAgents.learnTools, {
            societyId: args.societyId,
            actingUserId: args.actingUserId,
            toolNames,
          }),
      }),
      execute_tool: tool({
        description: "Execute one permissioned Societyer tool after learning its schema.",
        inputSchema: z.object({
          toolName: z.string(),
          arguments: z.record(z.string(), z.any()).optional(),
        }),
        execute: async ({ toolName, arguments: toolArguments }: { toolName: string; arguments?: Record<string, any> }) =>
          ctx.runMutation((api as any).aiAgents.executeTool, {
            societyId: args.societyId,
            actingUserId: args.actingUserId,
            threadId,
            agentKey: "chat",
            toolName,
            arguments: toolArguments ?? {},
          }),
      }),
    };

    let assistantText = "";
    let usage: unknown = undefined;
    let provider = "vercel_ai_sdk";
    try {
      if (!runtimeConfig.model) throw new Error("No AI provider key is configured.");
      const modelMessages = history
        .filter((message: any) => message.role === "user" || message.role === "assistant")
        .slice(-16)
        .map((message: any) => ({
          role: message.role,
          content: message.content,
        }));
      const result = streamText({
        model: runtimeConfig.model,
        system: context.systemPrompt,
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(6),
      } as any);
      for await (const chunk of result.textStream) assistantText += chunk;
      usage = await (result as any).usage?.catch?.(() => undefined);
      if (!assistantText.trim()) {
        provider = "vercel_ai_sdk_no_tools_retry";
        const retry = streamText({
          model: runtimeConfig.model,
          system: context.systemPrompt,
          messages: modelMessages,
        } as any);
        for await (const chunk of retry.textStream) assistantText += chunk;
        usage = await (retry as any).usage?.catch?.(() => usage);
      }
      if (!assistantText.trim()) {
        provider = "vercel_ai_sdk_generate_text_retry";
        const retry = await generateText({
          model: runtimeConfig.model,
          system: context.systemPrompt,
          messages: modelMessages,
        } as any);
        assistantText = retry.text ?? "";
        usage = (retry as any).usage ?? usage;
      }
      if (!assistantText.trim()) throw new Error("The model returned an empty response.");
    } catch (error: any) {
      provider = "deterministic_fallback";
      assistantText = fallbackResponse({
        error: error?.message,
        content: args.content,
        context,
      });
    }

    const messageId = await ctx.runMutation((internal as any).aiChat._appendMessage, {
      societyId: args.societyId,
      threadId,
      role: "assistant",
      content: assistantText,
      status: "complete",
      modelId,
      usage,
      parts: { provider },
      createdByUserId: args.actingUserId,
    });

    return { threadId, messageId, content: assistantText, provider, modelId };
  },
});

async function resolveAiRuntimeConfig(ctx: any, societyId: any, actingUserId: any, requestedModelId?: string) {
  const settings = await ctx.runQuery((api as any).aiSettings.getEffective, {
    societyId,
    actingUserId,
  }).catch(() => null);
  const effective = settings?.effective;
  const secret = effective?.secretVaultItemId
    ? await ctx.runQuery((internal as any).secrets._revealForServer, { id: effective.secretVaultItemId }).catch(() => null)
    : null;
  const provider = effective?.provider ?? (env("OPENROUTER_API_KEY") ? "openrouter" : "openai");
  const apiKey = secret?.value ?? (provider === "openrouter" ? env("OPENROUTER_API_KEY") : env("OPENAI_API_KEY")) ?? env("OPENAI_API_KEY");
  const modelId = requestedModelId ?? effective?.modelId ?? env("SOCIETYER_AI_MODEL") ?? (provider === "openrouter" ? "openai/gpt-4.1-mini" : "gpt-4.1-mini");
  const baseURL = effective?.baseUrl || (provider === "openrouter" ? OPENROUTER_BASE_URL : undefined);
  const openai = apiKey ? createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }) : null;
  const model = openai
    ? provider === "openrouter" || provider === "openai-compatible"
      ? openai.chat(modelId)
      : openai(modelId)
    : null;
  return {
    provider,
    modelId,
    model,
    configuredFrom: secret?.value ? effective.scope : apiKey ? "environment" : "missing",
  };
}

function fallbackResponse({ error, content, context }: { error?: string; content: string; context: any }) {
  const tools = Object.values(context?.toolCatalog ?? {})
    .flat()
    .map((toolEntry: any) => toolEntry.name)
    .slice(0, 12);
  const skills = (context?.skillCatalog ?? []).map((skill: any) => skill.name).slice(0, 8);
  return [
    "I can route this through Societyer skills and permissioned tools, but the live model provider is not configured.",
    "",
    `Request: ${content}`,
    `Provider: ${error ?? "No provider available"}`,
    "",
    `Relevant skill catalog: ${skills.join(", ") || "none"}.`,
    `Available tools for this actor: ${tools.join(", ") || "none"}.`,
    "",
    "Set OPENAI_API_KEY or OPENROUTER_API_KEY, or save a provider in AI setup, to enable Vercel AI SDK streamText responses. Tool calls, drafts, and audit logging are wired server-side.",
  ].join("\n");
}
