/**
 * A small OpenAI-compatible model server for tests (node:http, no deps).
 *
 * Speaks the shapes Ollama, LM Studio and llama.cpp expose:
 *   GET  /v1/models                 {data:[{id}]}
 *   GET  /api/tags                  {models:[{name, model}]}            (Ollama)
 *   POST /v1/chat/completions       JSON, or SSE when body.stream is true
 *   POST /v1/audio/transcriptions   multipart; OpenAI verbose_json (segments + top-level
 *                                   words), or WhisperX JSON (speakers) when `diarize=true`
 *                                   is sent or `speechSpeakers` is on
 *   POST /inference                 multipart; whisper.cpp verbose_json (words per segment)
 *
 * Speech replies are three short board-meeting lines (`MOCK_SPEECH_LINES`);
 * a file under 64 KB (the one-second Test connection WAV) gets no speech.
 *
 * Minutes requests (the shared minutes system prompt) get a deterministic
 * draft derived from the transcript in the prompt, so chunked drafting can be
 * checked; other chat requests get `chatReply`.
 *
 * Tool calling (requests that offer `tools`) follows `toolScript`: step N of
 * a turn (counted from the last user message) makes the calls in
 * `toolScript[N]`, streamed as OpenAI tool-call fragments or in one JSON body,
 * with arguments encoded as a JSON string, an object, or a string encoded
 * twice. When the script runs out, the reply describes the tool results it
 * was given (`mockToolAnswer`). `rejectTools` answers 400 like an Ollama model
 * without tool support; `toolsInText` writes the calls as `<tool_call>` text.
 * The tool test (`get_current_date`) is called whenever a script is set.
 * Presets: `MOCK_TOOL_SCRIPTS`.
 *
 * Faults are switchable at runtime: reject json_object (LM Studio) or
 * json_schema (older llama.cpp), wrap JSON in a code fence, fail with 500,
 * stall, require a key, CORS on/off, fail speech requests with a status.
 * Error bodies carry a marker string so
 * tests can prove the app never echoes provider bodies. Every request body is
 * recorded.
 *
 * Run standalone: `node --import tsx scripts/fixtures/mock-openai-server.ts [port]`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const PROVIDER_SECRET_MARKER = "PROVIDER-BODY-MARKER-4f2a";

export type MockFaults = {
  rejectJsonObject: boolean;
  rejectJsonSchema: boolean;
  fenced: boolean;
  fail500: boolean;
  /** Delay before answering (non-stream) or after the first chunk (stream). */
  stallMs: number;
  /** Send Access-Control-Allow-Origin. */
  cors: boolean;
  /** When set, requests must send `Authorization: Bearer <requireKey>`. */
  requireKey: string;
  chatReply: string;
  /** Characters per streamed chunk. */
  streamChunkChars: number;
  /** Answer 404 on /v1/models (servers that only expose Ollama's /api/tags). */
  modelsNotFound: boolean;
  /** Answer /v1/audio/transcriptions in WhisperX shape even without `diarize=true`. */
  speechSpeakers: boolean;
  /** Fail speech requests with this status (0: answer normally). */
  speechStatus: number;
  /** Tool calls per step of a turn; empty: a model that ignores tools. */
  toolScript: MockToolCall[][];
  /** Answer 400 to any request that offers tools. */
  rejectTools: boolean;
  /** Write tool calls into the reply text (`<tool_call>{…}</tool_call>`) instead of `tool_calls`. */
  toolsInText: boolean;
};

/** `string`: OpenAI's JSON string; `object`: the arguments object; `double`: a JSON string of a JSON string. */
export type MockToolCall = { name: string; arguments: unknown; encoding?: "string" | "object" | "double" };

export const MOCK_TOOL_PROBE = "get_current_date";

/** Scripted models for the on-device assistant's tool loop. */
export const MOCK_TOOL_SCRIPTS = {
  /** Looks up meetings once, then answers from the result. */
  listMeetingsThenAnswer: [[{ name: "list_meetings", arguments: { limit: 5 } }]],
  /** The same, with arguments as an object (some Ollama builds). */
  objectArgs: [[{ name: "list_meetings", arguments: { limit: 5 }, encoding: "object" }]],
  /** The same, with arguments JSON-encoded twice (some llama.cpp / LM Studio templates). */
  stringEncodedArgs: [[{ name: "list_meetings", arguments: { limit: 5 }, encoding: "double" }]],
  /** Asks for a change tool. */
  proposeTask: [[{ name: "create_governance_tasks", arguments: { tasks: [{ title: "Send the approved budget to members", priority: "High", dueDate: "2026-10-31" }] } }]],
  /** Arguments that fail the tool's schema. */
  invalidArgs: [[{ name: "list_meetings", arguments: { limit: "lots" } }]],
  /** A tool that doesn't exist, then one this person may not be offered. */
  disallowed: [[{ name: "delete_workspace", arguments: {} }, { name: "create_governance_tasks", arguments: { tasks: [{ title: "Sneaky" }] } }]],
  /** Never stops calling tools. */
  endless: Array.from({ length: 20 }, () => [{ name: "list_meetings", arguments: { limit: 1 } }]),
} satisfies Record<string, MockToolCall[][]>;

/** Recorded for speech requests instead of the raw multipart body. */
export type RecordedSpeechForm = { fields: Record<string, string[]>; fileName?: string; fileBytes: number };

export type RecordedRequest = {
  method: string;
  path: string;
  authorization?: string;
  origin?: string;
  body?: unknown;
};

const DEFAULT_FAULTS: MockFaults = {
  rejectJsonObject: false,
  rejectJsonSchema: false,
  fenced: false,
  fail500: false,
  stallMs: 0,
  cors: true,
  requireKey: "",
  chatReply: "Hello from the on-device mock model. Minutes should record motions, movers and outcomes.",
  streamChunkChars: 12,
  modelsNotFound: false,
  speechSpeakers: false,
  speechStatus: 0,
  toolScript: [],
  rejectTools: false,
  toolsInText: false,
};

type SpeechWord = [text: string, start: number, end: number, speaker?: string];
/** Three lines; the third changes speaker mid-line (WhisperX words carry it). */
export const MOCK_SPEECH_LINES: Array<{ start: number; end: number; speaker: string; words: SpeechWord[] }> = [
  { start: 0, end: 3.2, speaker: "SPEAKER_00", words: [["I", 0, 0.2], ["call", 0.3, 0.6], ["the", 0.7, 0.8], ["meeting", 0.9, 1.4], ["to", 1.5, 1.6], ["order.", 1.7, 3.2]] },
  { start: 3.4, end: 7.9, speaker: "SPEAKER_01", words: [["I", 3.4, 3.5], ["move", 3.6, 3.9], ["that", 4, 4.2], ["we", 4.3, 4.4], ["approve", 4.5, 5], ["the", 5.1, 5.2], ["budget.", 5.3, 7.9]] },
  { start: 8, end: 10.5, speaker: "SPEAKER_02", words: [["Seconded.", 8, 8.9, "SPEAKER_02"], ["Thank", 9.2, 9.6, "SPEAKER_00"], ["you.", 9.7, 10.5, "SPEAKER_00"]] },
];

const lineText = (words: SpeechWord[]) => words.map(([text]) => text).join(" ");

export function mockSpeechReply(shape: "openai" | "whisper-cpp" | "whisperx", silent = false) {
  const lines = silent ? [] : MOCK_SPEECH_LINES;
  const text = lines.map((line) => lineText(line.words)).join(" ");
  if (shape === "whisperx") {
    return {
      language: "en",
      segments: lines.map((line) => ({
        start: line.start,
        end: line.end,
        text: ` ${lineText(line.words)}`,
        speaker: line.speaker,
        words: line.words.map(([word, start, end, speaker]) => ({ word, start, end, score: 0.9, speaker: speaker ?? line.speaker })),
      })),
    };
  }
  if (shape === "whisper-cpp") {
    return {
      task: "transcribe",
      language: "english",
      duration: silent ? 1 : 10.5,
      text,
      segments: lines.map((line, id) => ({
        id,
        text: ` ${lineText(line.words)}`,
        start: line.start,
        end: line.end,
        words: line.words.map(([word, start, end]) => ({ word: ` ${word}`, start, end, probability: 0.9 })),
      })),
    };
  }
  return {
    task: "transcribe",
    language: "english",
    duration: silent ? 1 : 10.5,
    text,
    segments: lines.map((line, id) => ({ id, seek: 0, start: line.start, end: line.end, text: ` ${lineText(line.words)}`, tokens: [], temperature: 0, avg_logprob: -0.2 })),
    words: lines.flatMap((line) => line.words.map(([word, start, end]) => ({ word, start, end }))),
  };
}

type ChatBody = {
  model?: unknown;
  stream?: unknown;
  messages?: Array<{ role?: unknown; content?: unknown; tool_calls?: unknown }>;
  response_format?: { type?: unknown };
  tools?: Array<{ function?: { name?: unknown } }>;
};

function encodeArguments(call: MockToolCall): unknown {
  const text = JSON.stringify(call.arguments);
  if (call.encoding === "object") return call.arguments;
  if (call.encoding === "double") return JSON.stringify(text);
  return text;
}

/** Messages after the last user turn: the tool steps taken so far in this turn. */
function currentTurn(chat: ChatBody) {
  const messages = chat.messages ?? [];
  const lastUser = messages.map((message) => message.role).lastIndexOf("user");
  return messages.slice(lastUser + 1);
}

/**
 * The answer once the script is done: one sentence per tool result the turn
 * was given, so tests can see what came back.
 */
export function mockToolAnswer(chat: ChatBody): string {
  const results = currentTurn(chat).filter((message) => message.role === "tool").map((message) => String(message.content ?? ""));
  const parts = results.map((content) => {
    let value: Record<string, unknown> = {};
    try {
      value = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return "One result was cut short.";
    }
    const error = value.error as { code?: unknown } | undefined;
    if (error) return `A tool failed with ${String(error.code)}.`;
    if (value.status === "awaiting_approval") return "I proposed a change; it is waiting for your approval.";
    if (Array.isArray(value.meetings)) {
      const first = value.meetings[0] as { title?: unknown; scheduledAt?: unknown } | undefined;
      return `There are ${String(value.total)} meetings${first ? `; the latest is ${String(first.title)} (${String(first.scheduledAt ?? "").slice(0, 10)})` : ""}.`;
    }
    if (Array.isArray(value.tasks)) return `There are ${String(value.total)} tasks.`;
    return "I read one more record.";
  });
  return parts.length ? parts.join(" ") : "I didn't need to look anything up.";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A draft built only from the transcript in the user prompt. */
export function mockMinutesDraft(userPrompt: string) {
  const transcript = userPrompt.split("Transcript:\n").slice(1).join("Transcript:\n");
  const lines = transcript.split("\n").map((line) => line.trim()).filter(Boolean);
  const speakers = new Set<string>();
  const motions: Array<{ text: string; movedBy: string; outcome: string }> = [];
  const actionItems: Array<{ text: string; assignee?: string; done: boolean }> = [];
  for (const line of lines) {
    const speaker = line.match(/^([^:]{2,60}):\s*(.*)$/);
    if (!speaker) continue;
    speakers.add(speaker[1]);
    const moved = speaker[2].match(/^I move (?:that |to )?(.+?)\.?$/i);
    if (moved) motions.push({ text: moved[1].charAt(0).toUpperCase() + moved[1].slice(1), movedBy: speaker[1], outcome: "Carried" });
    const action = speaker[2].match(/^Action:\s*(.+?)\.?$/i);
    if (action) actionItems.push({ text: action[1], assignee: speaker[1], done: false });
  }
  return {
    discussion: `Mock summary of ${lines.length} line(s), starting: ${lines[0] ?? "(empty)"}`,
    motions,
    decisions: motions.map((motion) => `${motion.text} (carried)`),
    actionItems,
    attendees: [...speakers],
    absent: [],
  };
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readSpeechForm(request: IncomingMessage, raw: Buffer): Promise<RecordedSpeechForm> {
  const form = await new Response(new Uint8Array(raw), { headers: { "content-type": String(request.headers["content-type"] ?? "") } }).formData();
  const fields: Record<string, string[]> = {};
  let fileName: string | undefined;
  let fileBytes = 0;
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") (fields[name] ??= []).push(value);
    else {
      fileName = value.name;
      fileBytes = value.size;
    }
  }
  return { fields, fileName, fileBytes };
}

export async function startMockOpenAiServer(initial: Partial<MockFaults> = {}, port = 0) {
  const faults: MockFaults = { ...DEFAULT_FAULTS, ...initial };
  const requests: RecordedRequest[] = [];

  const cors = (request: IncomingMessage, response: ServerResponse) => {
    if (!faults.cors) return;
    response.setHeader("access-control-allow-origin", request.headers.origin ?? "*");
    response.setHeader("access-control-allow-headers", "authorization, content-type, accept");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("vary", "origin");
  };
  const json = (response: ServerResponse, status: number, payload: unknown) => {
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(payload));
  };
  const error = (response: ServerResponse, status: number, message: string) =>
    json(response, status, { error: { message: `${message} (${PROVIDER_SECRET_MARKER})`, type: "invalid_request_error" } });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    cors(request, response);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    const bytes = request.method === "POST" ? await readBody(request) : Buffer.alloc(0);
    const isSpeech = request.method === "POST" && (url.pathname === "/v1/audio/transcriptions" || url.pathname === "/inference");
    let body: unknown;
    if (isSpeech) {
      body = await readSpeechForm(request, bytes).catch(() => ({ fields: {}, fileBytes: 0 }));
    } else {
      const raw = bytes.toString("utf8");
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
    }
    requests.push({ method: request.method ?? "GET", path: url.pathname, authorization: request.headers.authorization, origin: request.headers.origin, body });

    if (faults.requireKey && request.headers.authorization !== `Bearer ${faults.requireKey}`) {
      error(response, 401, "Incorrect API key provided: sk-live-leaked");
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/models" && !faults.modelsNotFound) {
      json(response, 200, { object: "list", data: [{ id: "mock-llm", object: "model" }, { id: "mock-small", object: "model" }] });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/tags") {
      json(response, 200, { models: [{ name: "mock-llm:latest", model: "mock-llm:latest" }] });
      return;
    }
    if (isSpeech) {
      const form = body as RecordedSpeechForm;
      if (!form.fileBytes) {
        error(response, 400, "No audio file in the request");
        return;
      }
      if (faults.speechStatus) {
        error(response, faults.speechStatus, "speech model failure at /var/lib/whisper/secret");
        return;
      }
      if (faults.stallMs) await sleep(faults.stallMs);
      if (response.destroyed) return;
      const shape = url.pathname === "/inference" ? "whisper-cpp" : faults.speechSpeakers || form.fields.diarize?.[0] === "true" ? "whisperx" : "openai";
      json(response, 200, mockSpeechReply(shape, form.fileBytes < 64 * 1024));
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      error(response, 404, "Not found");
      return;
    }

    const chat = (body ?? {}) as ChatBody;
    const format = chat.response_format?.type;
    if (format === "json_object" && faults.rejectJsonObject) {
      error(response, 400, "'response_format.type' must be 'json_schema' or 'text'");
      return;
    }
    if (format === "json_schema" && faults.rejectJsonSchema) {
      error(response, 400, "json_schema is not supported by this server");
      return;
    }
    if (faults.fail500) {
      error(response, 500, "internal model failure at /var/lib/models/secret");
      return;
    }
    const offeredTools = (chat.tools ?? []).map((entry) => String(entry.function?.name ?? ""));
    if (offeredTools.length && faults.rejectTools) {
      error(response, 400, `registry.ollama.ai/library/${String(chat.model)} does not support tools`);
      return;
    }
    if (offeredTools.length) {
      const isProbe = offeredTools.length === 1 && offeredTools[0] === MOCK_TOOL_PROBE;
      const step = currentTurn(chat).filter((message) => message.role === "assistant" && message.tool_calls).length;
      const calls = isProbe ? (faults.toolScript.length ? [{ name: MOCK_TOOL_PROBE, arguments: {} }] : []) : faults.toolScript[step] ?? [];
      if (calls.length) {
        await sendToolCalls(response, chat, calls);
        return;
      }
      if (faults.toolScript.length || isProbe) {
        await sendText(response, chat, isProbe ? "I can't check dates." : mockToolAnswer(chat));
        return;
      }
    }
    const system = String(chat.messages?.[0]?.content ?? "");
    const user = String([...(chat.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "");
    const isMinutes = system.startsWith("You turn meeting transcripts into strict JSON");
    const draftJson = JSON.stringify(mockMinutesDraft(user));
    const content = isMinutes ? (faults.fenced ? "Here is the draft:\n```json\n" + draftJson + "\n```" : draftJson) : faults.chatReply;

    await sendText(response, chat, content);
  });

  /** A plain reply, streamed (SSE) or in one JSON body. */
  async function sendText(response: ServerResponse, chat: ChatBody, content: string) {
    if (chat.stream === true) {
      startStream(response);
      const chunkChars = faults.streamChunkChars;
      const pieces: string[] = [];
      for (let index = 0; index < content.length; index += chunkChars) pieces.push(content.slice(index, index + chunkChars));
      for (const [index, piece] of pieces.entries()) {
        if (response.destroyed) return;
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece } }] })}\n\n`);
        if (index === 0 && faults.stallMs) await sleep(faults.stallMs);
      }
      endStream(response);
      return;
    }
    if (faults.stallMs) await sleep(faults.stallMs);
    if (response.destroyed) return;
    json(response, 200, {
      id: "chatcmpl-mock",
      object: "chat.completion",
      model: chat.model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    });
  }

  /** Tool calls, as `tool_calls` (fragments when streamed) or as `<tool_call>` text. */
  async function sendToolCalls(response: ServerResponse, chat: ChatBody, calls: MockToolCall[]) {
    if (faults.toolsInText) {
      await sendText(response, chat, calls.map((call) => `<tool_call>${JSON.stringify({ name: call.name, arguments: call.arguments })}</tool_call>`).join("\n"));
      return;
    }
    const id = (index: number) => `call_mock_${requests.length}_${index}`;
    if (chat.stream !== true) {
      if (faults.stallMs) await sleep(faults.stallMs);
      if (response.destroyed) return;
      json(response, 200, {
        id: "chatcmpl-mock",
        object: "chat.completion",
        model: chat.model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: null, tool_calls: calls.map((call, index) => ({ id: id(index), type: "function", function: { name: call.name, arguments: encodeArguments(call) } })) },
          finish_reason: "tool_calls",
        }],
      });
      return;
    }
    startStream(response);
    // Read once: a test may change the faults while this response is still streaming.
    const chunkChars = faults.streamChunkChars;
    const chunk = (delta: unknown, finish: string | null = null) =>
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    for (const [index, call] of calls.entries()) {
      const encoded = encodeArguments(call);
      if (typeof encoded !== "string") {
        chunk({ tool_calls: [{ index, id: id(index), type: "function", function: { name: call.name, arguments: encoded } }] });
        continue;
      }
      chunk({ tool_calls: [{ index, id: id(index), type: "function", function: { name: call.name, arguments: "" } }] });
      for (let at = 0; at < encoded.length; at += chunkChars) {
        if (response.destroyed) return;
        chunk({ tool_calls: [{ index, function: { arguments: encoded.slice(at, at + chunkChars) } }] });
        if (at === 0 && faults.stallMs) await sleep(faults.stallMs);
      }
    }
    if (response.destroyed) return;
    chunk({}, "tool_calls");
    endStream(response);
  }

  function startStream(response: ServerResponse) {
    response.statusCode = 200;
    response.setHeader("content-type", "text/event-stream");
    response.setHeader("cache-control", "no-cache");
  }

  function endStream(response: ServerResponse) {
    if (response.destroyed) return;
    response.write("data: [DONE]\n\n");
    response.end();
  }
  server.keepAliveTimeout = 1000;

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    baseUrl: `${origin}/v1`,
    port: address.port,
    requests,
    faults,
    set(patch: Partial<MockFaults>) {
      Object.assign(faults, patch);
    },
    reset() {
      Object.assign(faults, DEFAULT_FAULTS);
      requests.length = 0;
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export type MockOpenAiServer = Awaited<ReturnType<typeof startMockOpenAiServer>>;

// Standalone: `node --import tsx scripts/fixtures/mock-openai-server.ts 11999`
if (process.argv[1] && /mock-openai-server\.ts$/.test(process.argv[1])) {
  const port = Number(process.argv[2] ?? 0);
  void startMockOpenAiServer({}, Number.isFinite(port) ? port : 0).then((server) => {
    console.log(`mock OpenAI-compatible server on ${server.baseUrl}`);
  });
}
