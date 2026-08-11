import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/planner", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sse(body: string) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/planner", () => {
  it("relays fake Runner SSE replies without buffering", async () => {
    vi.stubEnv("AGENT_RUNNER_URL", "http://runner.test/");
    const fetch = vi.fn().mockResolvedValue(sse('event: token\ndata: {"text":"Hello"}\n\nevent: done\ndata: {}\n\n'));
    vi.stubGlobal("fetch", fetch);

    const response = await POST(request({ message: "Plan dinners", planningHorizon: "2099-01-07", conversationId: "chat-1" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await expect(response.text()).resolves.toContain('"Hello"');
    expect(fetch).toHaveBeenCalledWith("http://runner.test/v1/chat", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ message: "Plan dinners", planningHorizon: "2099-01-07", conversationId: "chat-1" }),
    }));
  });

  it("relays a rejection revision to the same fake Runner contract", async () => {
    vi.stubEnv("AGENT_RUNNER_URL", "http://runner.test");
    const fetch = vi.fn()
      .mockResolvedValueOnce(sse('event: proposal\ndata: {"proposalId":"proposal-1"}\n\n'))
      .mockResolvedValueOnce(sse('event: token\ndata: {"text":"Revised"}\n\n'));
    vi.stubGlobal("fetch", fetch);

    await (await POST(request({ message: "Plan through Friday", planningHorizon: "2099-01-07", conversationId: "chat-1" }))).text();
    const revision = await POST(request({
      message: "Proposal was rejected. Keep Thursday empty.",
      planningHorizon: "2099-01-07",
      conversationId: "chat-1",
      proposalId: "proposal-1",
    }));

    expect(revision.status).toBe(200);
    await expect(revision.text()).resolves.toContain("Revised");
    expect(JSON.parse((fetch.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
      proposalId: "proposal-1",
      message: "Proposal was rejected. Keep Thursday empty.",
    });
  });

  it("degrades cleanly without a runner and reports an unreachable runner", async () => {
    vi.stubEnv("AGENT_RUNNER_URL", "");
    const noRunner = await POST(request({ message: "Plan", planningHorizon: "2099-01-07" }));
    expect(noRunner.status).toBe(404);
    await expect(noRunner.json()).resolves.toEqual({ error: "Planning is unavailable on this deployment." });

    vi.stubEnv("AGENT_RUNNER_URL", "http://runner.test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const unreachable = await POST(request({ message: "Plan", planningHorizon: "2099-01-07" }));
    expect(unreachable.status).toBe(502);
    await expect(unreachable.json()).resolves.toEqual({ error: "Planner is unavailable. Check the Agent Runner connection." });
  });
});
