import type { CliBinary } from "./binary.js";
import type { CliChatRequest } from "./request.js";
import type { ToolOutcome } from "./toolBridge.js";

/** What a Claude or Codex run needs. */
export type CliRunOptions = {
  binary: CliBinary;
  env: NodeJS.ProcessEnv;
  request: CliChatRequest;
  signal: AbortSignal;
  /** Streamed answer text (not called for structured output, which arrives whole). */
  onText(text: string): void;
  /** The CLI is running and signed in: output will follow (it may think for a while first). */
  onAlive?(): void;
  /** Runs one of `request.tools`; only given for streamed requests. */
  callTool?(name: string, args: string): Promise<ToolOutcome>;
};
