// A stand-in for `codex` in scripts/check-cli-ai.ts: `--version`, `mcp list --json`
// and a small `app-server` speaking the v2 JSON-RPC protocol over stdio.
// FAKE_CODEX_RECORD names a file that receives one JSON line per thing worth checking.
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
const record = (entry) => {
  if (process.env.FAKE_CODEX_RECORD) appendFileSync(process.env.FAKE_CODEX_RECORD, `${JSON.stringify(entry)}\n`);
};

if (args.includes("--version")) {
  process.stdout.write("codex-cli 9.9.9\n");
  process.exit(0);
}
if (args.includes("mcp") && args.includes("list")) {
  record({ kind: "mcp-list", args });
  process.stdout.write(JSON.stringify([{ name: "home", enabled: true }, { name: "dotted.name", enabled: false }]));
  process.exit(0);
}
if (!args.includes("app-server")) process.exit(2);
record({ kind: "app-server", args });

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const waiting = new Map();
let nextServerId = 0;
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = `srv-${++nextServerId}`;
    waiting.set(id, resolve);
    send({ id, method, params });
  });
const notify = (method, params) => send({ method, params });
const threads = new Map();
const interrupted = new Set();

async function playTurn(threadId, turnId, params) {
  const thread = threads.get(threadId);
  const prompt = params.input?.[0]?.text ?? "";
  if (prompt.includes("HANG")) return;
  if (prompt.includes("MANY")) {
    notify("item/agentMessage/delta", { threadId, turnId, itemId: "m0", delta: "Partial answer." });
    for (let call = 1; call <= 40 && !interrupted.has(turnId); call += 1) {
      const reply = await ask("item/tool/call", { threadId, turnId, callId: `c${call}`, namespace: null, tool: thread.dynamicTools[0].name, arguments: { query: String(call) } });
      record({ kind: "many-tool-call", call, success: reply.result?.success });
    }
    return;
  }
  if (prompt.includes("FAIL")) {
    notify("error", { error: { message: "Usage limit", codexErrorInfo: "usageLimitExceeded" }, willRetry: false, threadId, turnId });
    notify("turn/completed", { threadId, turn: { id: turnId, status: "failed", error: { message: "Usage limit", codexErrorInfo: "usageLimitExceeded" } } });
    return;
  }
  record({ kind: "approval", reply: await ask("item/commandExecution/requestApproval", { threadId, turnId, itemId: "cmd" }) });
  record({ kind: "user-input", reply: await ask("item/tool/requestUserInput", { threadId, turnId, itemId: "q", questions: [] }) });
  record({ kind: "attestation", reply: await ask("attestation/generate", { threadId }) });
  let answer = "Plain answer.";
  if (params.outputSchema) answer = '{"ok":true}';
  else if (thread.dynamicTools?.length) {
    const reply = await ask("item/tool/call", { threadId, turnId, callId: "c1", namespace: null, tool: thread.dynamicTools[0].name, arguments: { query: "budget" } });
    record({ kind: "tool-call", reply });
    answer = `Answer: ${reply.result?.contentItems?.[0]?.text}`;
  }
  notify("item/agentMessage/delta", { threadId: "someone-else", turnId: "other", itemId: "x", delta: "NOT OURS" });
  const half = Math.ceil(answer.length / 2);
  notify("item/agentMessage/delta", { threadId, turnId, itemId: "m1", delta: answer.slice(0, half) });
  notify("item/agentMessage/delta", { threadId, turnId, itemId: "m1", delta: answer.slice(half) });
  notify("item/completed", { threadId, turnId, item: { type: "agentMessage", id: "m1", text: answer, phase: "final_answer" } });
  notify("turn/completed", { threadId, turn: { id: turnId, status: "completed", error: null } });
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === undefined) {
    const resolve = waiting.get(message.id);
    waiting.delete(message.id);
    resolve?.(message);
    return;
  }
  const { id, method, params } = message;
  switch (method) {
    case "initialize":
      record({ kind: "initialize", params });
      send({ id, result: { userAgent: "fake-codex", codexHome: "/tmp/fake", platformFamily: "unix", platformOs: "macos" } });
      break;
    case "initialized":
      break;
    case "account/read":
      send({
        id,
        result: process.env.FAKE_CODEX_SIGNED_OUT
          ? { account: null, requiresOpenaiAuth: true, userId: null, workspaceRouting: null }
          : { account: { type: "chatgpt", email: "person@example.com", planType: "plus", workspaceName: null }, requiresOpenaiAuth: true, userId: null, workspaceRouting: null },
      });
      break;
    case "model/list":
      send({
        id,
        result: params?.cursor
          ? { data: [{ id: "gpt-b", model: "gpt-b", hidden: false }], nextCursor: null }
          : { data: [{ id: "gpt-a", model: "gpt-a", hidden: false }, { id: "gpt-hidden", model: "gpt-hidden", hidden: true }], nextCursor: "page-2" },
      });
      break;
    case "thread/start": {
      record({ kind: "thread/start", params });
      // Never answered: a stuck app-server.
      if (String(params.baseInstructions).includes("NO_THREAD")) break;
      const threadId = `thr-${threads.size + 1}`;
      threads.set(threadId, params);
      send({ id, result: { thread: { id: threadId }, model: params.model ?? "gpt-a", instructionSources: [] } });
      break;
    }
    case "turn/start": {
      record({ kind: "turn/start", params });
      const turnId = `turn-${params.threadId}`;
      send({ id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      void playTurn(params.threadId, turnId, params);
      break;
    }
    case "turn/interrupt":
      record({ kind: "turn/interrupt", params });
      interrupted.add(params.turnId);
      send({ id, result: {} });
      notify("turn/completed", { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted", error: null } });
      break;
    case "thread/unsubscribe":
      record({ kind: "thread/unsubscribe", params });
      send({ id, result: { status: "unsubscribed" } });
      break;
    default:
      send({ id, error: { code: -32601, message: `unknown ${method}` } });
  }
});
