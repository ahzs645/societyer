import { isLocalDataRuntime } from "./staticRuntime";

/**
 * Server-only actions (browser connectors, Paperless, registry imports) cannot
 * run in a local or demo workspace. Pages disable them up front and explain
 * why, instead of letting the request fail with an HTTP 500 or a raw
 * JavaScript error (ui-governance G-13).
 */
export function serverActionsUnavailable(): boolean {
  return isLocalDataRuntime();
}

export function serverConnectionMessage(action: string): string {
  return `${action} needs a server connection. This workspace runs locally in your browser, so connectors to outside services are not available here. Connect to a hosted Societyer workspace to use it, or enter the records manually.`;
}

/** Turn a failed server call into a readable message. HTTP 5xx, missing
 *  offline handlers and null session results all mean "no server here". */
export function serverActionErrorMessage(action: string, error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    serverActionsUnavailable() ||
    /Request failed with 5\d\d|No offline handler|CAPABILITY_UNAVAILABLE|reading 'sessionId'|Failed to fetch|NetworkError/i.test(message)
  ) {
    return serverConnectionMessage(action);
  }
  return message || fallback;
}
