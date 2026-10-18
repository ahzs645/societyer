/**
 * Plain-language messages for AI provider failures.
 *
 * Provider error bodies can echo request details, internal hostnames or parts
 * of a key, so they are never shown or stored. Only the HTTP status (or the
 * kind of network failure) decides the message.
 */

export function aiProviderStatusMessage(status: number): string {
  if (status === 400) return "The AI provider rejected the request. Check the model name.";
  if (status === 401 || status === 403) return "The AI provider rejected the API key.";
  if (status === 404) return "The AI provider address or model was not found.";
  if (status === 408 || status === 504) return "The AI provider took too long to answer.";
  if (status === 413) return "The request was too large for the AI provider.";
  if (status === 429) return "The AI provider is rate limiting requests. Try again shortly.";
  if (status >= 500) return "The AI provider had an internal error. Try again shortly.";
  return `The AI provider returned an error (status ${status}).`;
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = candidate.statusCode ?? candidate.status;
  return typeof status === "number" && status >= 100 && status < 600 ? status : undefined;
}

/** A safe message for any error thrown while calling a provider. */
export function aiProviderErrorMessage(error: unknown): string {
  const status = errorStatus(error);
  if (status !== undefined) return aiProviderStatusMessage(status);
  const row = error && typeof error === "object" ? (error as { name?: unknown; lastError?: unknown }) : undefined;
  const name = String(row?.name ?? "");
  // The AI SDK wraps the final attempt of a retried call.
  if (name === "AI_RetryError" && row?.lastError) return aiProviderErrorMessage(row.lastError);
  if (name === "AbortError" || name === "TimeoutError") return "The AI request was stopped before it finished.";
  if (name === "OutboundUrlPolicyError") return "The AI provider address is not allowed on this server.";
  if (/NoObjectGenerated|JSONParse|TypeValidation|NoContentGenerated|EmptyResponse/.test(name)) {
    return "The AI provider's reply was empty or not in the expected format.";
  }
  return "Could not reach the AI provider.";
}
