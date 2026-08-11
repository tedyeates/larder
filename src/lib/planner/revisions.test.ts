import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyPlannerOfRejectedProposal } from "./revisions";

function sse(body: string) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("notifyPlannerOfRejectedProposal", () => {
  it("posts rejection comments and the proposalId, and drains the stream to completion", async () => {
    const fetch = vi.fn().mockResolvedValue(sse('event: token\ndata: {"text":"Revised"}\n\nevent: done\ndata: {}\n\n'));
    vi.stubGlobal("fetch", fetch);

    const result = await notifyPlannerOfRejectedProposal("proposal-1", "Keep Thursday empty");

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/planner", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.proposalId).toBe("proposal-1");
    expect(body.message).toContain("proposal-1");
    expect(body.message).toContain("Keep Thursday empty");
  });

  it("falls back to a default comment note when no comment is supplied", async () => {
    const fetch = vi.fn().mockResolvedValue(sse("event: done\ndata: {}\n\n"));
    vi.stubGlobal("fetch", fetch);

    await notifyPlannerOfRejectedProposal("proposal-1", "   ");

    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.message).toContain("No comment supplied");
  });

  it("returns false without throwing when no Agent Runner is configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Planning is unavailable on this deployment." }), { status: 404 })));

    await expect(notifyPlannerOfRejectedProposal("proposal-1", "comment")).resolves.toBe(false);
  });

  it("throws a readable error when the Runner is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(notifyPlannerOfRejectedProposal("proposal-1", "comment")).rejects.toThrow();
  });

  it("throws the Runner's structured error message on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Planner is unavailable. Check the Agent Runner connection." }), { status: 502 }))
    );

    await expect(notifyPlannerOfRejectedProposal("proposal-1", "comment")).rejects.toThrow("Planner is unavailable. Check the Agent Runner connection.");
  });

  it("throws when the Runner responds ok with no readable body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(notifyPlannerOfRejectedProposal("proposal-1", "comment")).rejects.toThrow("Planner sent no reply.");
  });
});
