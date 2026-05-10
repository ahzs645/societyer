"use node";

import { v } from "convex/values";
import { action } from "./lib/untypedServer";
import { api, internal } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

function env(name: string): string | undefined {
  return process.env[name];
}

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
    const modelId = args.modelId ?? env("SOCIETYER_AI_MODEL") ?? "gpt-4.1-mini";
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

    const model = aiModel(modelId);
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
      if (!model) throw new Error("OPENAI_API_KEY is not configured.");
      const result = streamText({
        model,
        system: context.systemPrompt,
        messages: history
          .filter((message: any) => message.role === "user" || message.role === "assistant")
          .slice(-16)
          .map((message: any) => ({
            role: message.role,
            content: message.content,
          })),
        tools,
        stopWhen: stepCountIs(6),
      } as any);
      for await (const chunk of result.textStream) assistantText += chunk;
      usage = await (result as any).usage?.catch?.(() => undefined);
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

function aiModel(modelId: string) {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) return null;
  const openai = createOpenAI({ apiKey });
  return openai(modelId);
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
    "Set OPENAI_API_KEY to enable Vercel AI SDK streamText responses. Tool calls, drafts, and audit logging are wired server-side.",
  ].join("\n");
}
