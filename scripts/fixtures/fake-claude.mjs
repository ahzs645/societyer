// A stand-in for `claude -p --output-format stream-json` in scripts/check-cli-ai.ts,
// so CI never needs the real CLI. FAKE_CLAUDE_MODE picks the behaviour;
// FAKE_CLAUDE_RECORD names a file that receives what the run saw.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? "text";
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const session = "00000000-0000-4000-8000-000000000000";
const delta = (text, extra = {}) =>
  out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }, parent_tool_use_id: null, session_id: session, ...extra });
const blockStart = () => out({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, parent_tool_use_id: null, session_id: session });
const result = (fields) => out({ type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1, session_id: session, ...fields });

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function mcp(config, method, params, id) {
  const server = config.mcpServers.societyer;
  const response = await fetch(server.url, {
    method: "POST",
    headers: { ...server.headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params }),
  });
  return response.status === 202 ? null : response.json();
}

if (args[0] === "--version") {
  process.stdout.write("2.1.999 (Claude Code)\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  const signedIn = mode !== "signed-out";
  process.stdout.write(JSON.stringify(signedIn ? { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "person@example.com", subscriptionType: "max" } : { loggedIn: false, authMethod: "none", apiProvider: "firstParty" }));
  process.exit(signedIn ? 0 : 1);
}

const prompt = await readStdin();
if (process.env.FAKE_CLAUDE_RECORD) {
  const systemFile = flag("--system-prompt-file");
  writeFileSync(
    process.env.FAKE_CLAUDE_RECORD,
    JSON.stringify({
      args,
      cwd: process.cwd(),
      prompt,
      systemPrompt: systemFile ? readFileSync(systemFile, "utf8") : null,
      settings: flag("--settings") ? readFileSync(flag("--settings"), "utf8") : null,
      env: { autoMemory: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? null, claudecode: process.env.CLAUDECODE ?? null },
    }),
  );
}

out({ type: "system", subtype: "init", cwd: process.cwd(), session_id: session, tools: [], mcp_servers: [], model: flag("--model") ?? "claude-sonnet", apiKeySource: "none" });

if (mode === "reject-no-session" && args.includes("--no-session-persistence")) {
  process.stderr.write("error: unknown option '--no-session-persistence'\n");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const messageStart = () => out({ type: "stream_event", event: { type: "message_start", message: { role: "assistant" } }, parent_tool_use_id: null, session_id: session });

if (mode === "slow") {
  // Signed in and answering, but thinking for a while before any text.
  messageStart();
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } }, parent_tool_use_id: null, session_id: session });
  await sleep(Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 300));
  blockStart();
  delta("Thought it through.");
  result({ result: "Thought it through." });
} else if (mode === "silent") {
  // Nothing at all for a while (a slow start before the API answers).
  await sleep(Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 300));
  blockStart();
  delta("Late answer.");
  result({ result: "Late answer." });
} else if (mode === "many-tools") {
  const config = JSON.parse(readFileSync(flag("--mcp-config"), "utf8"));
  await mcp(config, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-claude", version: "0" } }, 1);
  blockStart();
  delta("Partial answer.");
  for (let id = 2; id < 60; id += 1) {
    const called = await mcp(config, "tools/call", { name: "list_meetings", arguments: { query: String(id) } }, id);
    if (called.result.isError) {
      // A real CLI would keep going until --max-turns; this one waits to be stopped.
      setInterval(() => undefined, 1000);
      break;
    }
  }
} else if (mode === "hang") {
  setInterval(() => undefined, 1000);
} else if (mode === "auth") {
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Not logged in · Please run /login" }] }, error: "authentication_failed", parent_tool_use_id: null, session_id: session });
  result({ subtype: "success", is_error: true, result: "Not logged in · Please run /login" });
} else if (mode === "limit") {
  out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1795183200, rateLimitType: "five_hour" }, session_id: session });
  result({ is_error: true, result: "Claude AI usage limit reached" });
} else if (mode === "crash") {
  process.stderr.write("boom\n");
  process.exit(3);
} else if (mode === "schema") {
  result({ result: "", structured_output: { title: "Board meeting", motions: 2 } });
} else if (mode === "tools") {
  const config = JSON.parse(readFileSync(flag("--mcp-config"), "utf8"));
  const init = await mcp(config, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-claude", version: "0" } }, 1);
  await mcp(config, "notifications/initialized", {});
  const listed = await mcp(config, "tools/list", {}, 2);
  const tool = listed.result.tools[0];
  const called = await mcp(config, "tools/call", { name: tool.name, arguments: { query: "budget" } }, 3);
  blockStart();
  delta(`Looked up ${tool.name} (protocol ${init.result.protocolVersion}).`);
  // A sub-agent's text never reaches the answer.
  delta("SUBAGENT", { parent_tool_use_id: "toolu_1" });
  blockStart();
  delta(`Result: ${called.result.content[0].text}${called.result.isError ? " (error)" : ""}`);
  result({ result: "ignored when text streamed" });
} else {
  blockStart();
  delta("Hello");
  delta(" world");
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] }, parent_tool_use_id: null, session_id: session });
  result({ result: "Hello world" });
}
