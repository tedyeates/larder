import { createServer } from "node:http";
import { spawn } from "node:child_process";

const port = Number(process.env.PORT ?? 8080);
const conversations = new Map();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function runnerConfig() {
  for (const forbidden of ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    if (process.env[forbidden]) throw new Error(`${forbidden} must not be available to Agent Runner`);
  }
  return { larderUrl: required("LARDER_URL").replace(/\/$/, ""), token: required("LARDER_AGENT_TOKEN") };
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 20_000) throw new Error("Request too large");
  }
  const value = JSON.parse(raw);
  if (!value || typeof value.message !== "string" || value.message.trim() === "") throw new Error("message must be non-blank text");
  return value;
}

function event(response, name, body) {
  response.write(`event: ${name}\ndata: ${JSON.stringify(body)}\n\n`);
}

function runnerArgs(prompt) {
  if (process.env.KIRO_CHAT_ARGS) {
    const args = JSON.parse(process.env.KIRO_CHAT_ARGS);
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) throw new Error("KIRO_CHAT_ARGS must be a JSON string array");
    return args.map((arg) => arg.replaceAll("{prompt}", prompt));
  }
  return ["chat", "--agent-file", "/runner/agent/planner.md", "--mcp-config", "/runner/mcp.json", "--output-format", "stream-json", "--prompt", prompt];
}

function visibleText(line) {
  try {
    const value = JSON.parse(line);
    if (typeof value === "string") return value;
    if (typeof value?.delta === "string") return value.delta;
    if (typeof value?.text === "string") return value.text;
    if (typeof value?.content === "string") return value.content;
  } catch {
    // Kiro versions that render text rather than stream JSON still work.
  }
  return line;
}

function conversationPrompt(input) {
  const conversationId = typeof input.conversationId === "string" ? input.conversationId : "default";
  const history = conversations.get(conversationId) ?? [];
  const instruction = [
    `Planning horizon: ${typeof input.planningHorizon === "string" ? input.planningHorizon : "not specified"}.`,
    input.proposalId ? `This revises rejected Plan Proposal ${input.proposalId}; use that proposalId when calling larder_submit_plan_proposal.` : "",
    `User: ${input.message.trim()}`,
  ].filter(Boolean).join("\n");
  conversations.set(conversationId, [...history, instruction].slice(-12));
  return [...(conversations.get(conversationId) ?? []), "Respond using the planning agent instructions."].join("\n\n");
}

function streamChat(response, input, config) {
  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  const command = process.env.KIRO_COMMAND ?? "kiro-cli";
  const child = spawn(command, runnerArgs(conversationPrompt(input)), {
    env: { ...process.env, LARDER_URL: config.larderUrl, LARDER_AGENT_TOKEN: config.token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let remainder = "";
  let sentProposal = false;
  const send = (line) => {
    const text = visibleText(line);
    const proposal = /PLAN_PROPOSAL_ID:\s*([0-9a-f-]{36})/i.exec(text);
    if (proposal && !sentProposal) {
      sentProposal = true;
      event(response, "proposal", { proposalId: proposal[1] });
    }
    const visible = text.replace(/PLAN_PROPOSAL_ID:\s*[0-9a-f-]{36}/ig, "").trim();
    if (visible) event(response, "token", { text: visible });
  };
  child.stdout.on("data", (chunk) => {
    remainder += chunk.toString();
    const lines = remainder.split(/\r?\n/);
    remainder = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) send(line);
  });
  child.on("error", () => {
    event(response, "error", { error: "Planner process could not start." });
    event(response, "done", {});
    response.end();
  });
  child.on("close", (code) => {
    if (remainder.trim()) send(remainder);
    if (code !== 0) event(response, "error", { error: "Planner stopped before completing its reply." });
    event(response, "done", {});
    response.end();
  });
  response.on("close", () => child.kill());
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") return writeJson(response, 200, { ok: true });
  if (request.method !== "POST" || request.url !== "/v1/chat") return writeJson(response, 404, { error: "Not found" });
  try {
    const input = await readJson(request);
    streamChat(response, input, runnerConfig());
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : "Invalid request" });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Agent Runner listening on ${port}`));
