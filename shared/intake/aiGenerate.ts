/** Adapter from an `ai` SDK v6 language model to the intake GenerateObjectFn:
 * schema-constrained generateObject (JSON schema derived from the zod record
 * schema), bounded retries and output, non-strict JSON schema so optional
 * FieldValues stay optional on OpenAI-compatible endpoints. Used by the Node
 * CLI and the Convex intake action alike (not imported by browser code). */
import { generateObject, type LanguageModel } from "ai";
import type { GenerateObjectFn } from "./llm";

export function makeGenerateObject(model: LanguageModel, options: { maxRetries?: number; temperature?: number } = {}): GenerateObjectFn {
  return async ({ system, prompt, schema, schemaName, maxOutputTokens }) => {
    const result = await generateObject({
      model,
      system,
      prompt,
      schema,
      schemaName,
      schemaDescription: "Field-level extraction with verbatim source locators.",
      maxOutputTokens: maxOutputTokens ?? 16000,
      maxRetries: options.maxRetries ?? 2,
      temperature: options.temperature ?? 0,
      providerOptions: { openai: { strictJsonSchema: false } },
    } as Parameters<typeof generateObject>[0]);
    const usage = result.usage as { inputTokens?: number; outputTokens?: number } | undefined;
    return { object: result.object, usage: { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens } };
  };
}
