/**
 * The tool bridge between a CLI run and the renderer (pure).
 *
 * The CLI runs the tool loop itself. When it calls one of the tools the
 * renderer offered, the call is sent down the stream as a `tool_call` event
 * and the CLI waits until the renderer answers with `localAiToolResult` for
 * that call id. The renderer applies every policy (permissions, budgets,
 * approval cards); this side only bounds the loop: a 3-minute wait per call
 * and 30 calls per request. A call past the cap is answered with an error and
 * reported through `onCapReached`, so the caller can stop the run.
 */
import { randomUUID } from "node:crypto";

import type { DesktopLocalAiStreamEvent } from "../../src/lib/desktopBridge";
import { LocalAiProxyError } from "../localAiProxy.js";

export const TOOL_CALL_TIMEOUT_MS = 3 * 60_000;
export const MAX_TOOL_CALLS = 30;
/** What the model sees after MAX_TOOL_CALLS. */
export const TOOL_CALL_CAP_MESSAGE = "Enough has been looked up; answer with what you have.";
const MAX_RESULT_CHARS = 400_000;

export type ToolOutcome = { content: string; isError: boolean };

type Pending = { resolve: (outcome: ToolOutcome) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class ToolCallBridge {
  private readonly pending = new Map<string, Pending>();
  private calls = 0;
  private closed: Error | null = null;

  constructor(
    private readonly emit: (event: Extract<DesktopLocalAiStreamEvent, { type: "tool_call" }>) => void,
    private readonly timeoutMs = TOOL_CALL_TIMEOUT_MS,
    private readonly maxCalls = MAX_TOOL_CALLS,
    private readonly onCapReached: () => void = () => undefined,
  ) {}

  get callCount() {
    return this.calls;
  }

  /** Sends the call to the renderer and waits for its answer. Rejects only when the request ends. */
  call(name: string, args: string): Promise<ToolOutcome> {
    if (this.closed) return Promise.reject(this.closed);
    this.calls += 1;
    if (this.calls > this.maxCalls) {
      this.onCapReached();
      return Promise.resolve({ content: TOOL_CALL_CAP_MESSAGE, isError: true });
    }
    const callId = `call_${randomUUID().replace(/-/g, "")}`;
    return new Promise<ToolOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        resolve({ content: "The tool took too long to answer.", isError: true });
      }, this.timeoutMs);
      this.pending.set(callId, { resolve, reject, timer });
      this.emit({ type: "tool_call", callId, name, arguments: args });
    });
  }

  /** The renderer's answer; false when no call with that id is waiting (late or unknown). */
  resolve(callId: string, content: string, isError = false): boolean {
    const entry = this.pending.get(callId);
    if (!entry) return false;
    this.pending.delete(callId);
    clearTimeout(entry.timer);
    const text = content.length > MAX_RESULT_CHARS ? `${content.slice(0, MAX_RESULT_CHARS)}\n[cut: the result was too long]` : content;
    entry.resolve({ content: text, isError });
    return true;
  }

  /** Ends the request: waiting calls are rejected and new ones refused. */
  close(error: Error = new LocalAiProxyError("aborted", "The AI request was stopped.")) {
    if (this.closed) return;
    this.closed = error;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
