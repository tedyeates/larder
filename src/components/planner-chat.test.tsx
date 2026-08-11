import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlannerChat } from "./planner-chat";

function sse(body: string) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("PlannerChat", () => {
  it("defaults horizon to a week out, streams tokens, and supports a revision", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(sse('event: token\ndata: {"text":"First "}\n\nevent: token\ndata: {"text":"plan"}\n\nevent: proposal\ndata: {"proposalId":"proposal-1"}\n\nevent: done\ndata: {}\n\n'))
      .mockResolvedValueOnce(sse('event: token\ndata: {"text":"Revised plan"}\n\nevent: done\ndata: {}\n\n'));
    vi.stubGlobal("fetch", fetch);
    render(<PlannerChat />);

    const horizon = screen.getByLabelText("Plan through") as HTMLInputElement;
    expect(horizon.value).toBe(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Plan dinners" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("First plan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review proposal" })).toHaveAttribute("href", "/plan/review");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Make it vegetarian" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Revised plan")).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetch.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
      message: "Make it vegetarian",
      proposalId: "proposal-1",
    });
  });

  it("renders a final SSE token even when the stream closes without its delimiter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse('event: token\ndata: {"text":"Complete reply"}\n')));
    render(<PlannerChat />);

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Plan dinners" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Complete reply")).toBeInTheDocument();
  });

  it("shows Runner errors instead of crashing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Planner is unavailable. Check the Agent Runner connection." }), { status: 502 })));
    render(<PlannerChat />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Plan dinners" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Planner is unavailable");
  });
});
