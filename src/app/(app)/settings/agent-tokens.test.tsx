import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AgentTokensPanel } from "./agent-tokens";

type Token = { id: string; label: string; createdAt: string; revokedAt: string | null };

const activeToken: Token = {
  id: "token-1",
  label: "Desktop planner",
  createdAt: "2026-08-09T10:00:00Z",
  revokedAt: null,
};

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("AgentTokensPanel", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(response({ tokens: [activeToken] }));
  });

  it("renders loaded Agent Tokens and an empty state", async () => {
    const { unmount } = render(<AgentTokensPanel />);
    await waitFor(() => expect(screen.getByText("Desktop planner")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    unmount();

    fetchMock.mockReset().mockResolvedValue(response({ tokens: [] }));
    render(<AgentTokensPanel />);
    await waitFor(() => expect(screen.getByTestId("agent-tokens-empty")).toBeInTheDocument());
  });

  it("shows an error when token metadata cannot load", async () => {
    fetchMock.mockResolvedValue(response({ error: "network down" }, 500));
    render(<AgentTokensPanel />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network down"));
  });

  it("mints a token, displays its secret once, and retains only metadata in the list", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ tokens: [] }))
      .mockResolvedValueOnce(
        response({
          token: "agt_1234567890123456789012345678901234567890123",
          agentToken: activeToken,
        }, 201)
      );
    render(<AgentTokensPanel />);

    await waitFor(() => expect(screen.getByTestId("agent-tokens-empty")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Token label"), { target: { value: "Desktop planner" } });
    fireEvent.click(screen.getByRole("button", { name: "Mint Agent Token" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/agent-tokens",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ label: "Desktop planner" }),
        })
      );
    });
    expect(screen.getByTestId("agent-token-secret")).toHaveTextContent("agt_1234567890123456789012345678901234567890123");
    expect(screen.getByText("Desktop planner")).toBeInTheDocument();
  });

  it("revokes an active token and removes its revoke control", async () => {
    const revokedToken = { ...activeToken, revokedAt: "2026-08-09T11:00:00Z" };
    fetchMock
      .mockResolvedValueOnce(response({ tokens: [activeToken] }))
      .mockResolvedValueOnce(response({ agentToken: revokedToken }));
    render(<AgentTokensPanel />);

    await waitFor(() => expect(screen.getByText("Desktop planner")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/agent-tokens",
        expect.objectContaining({ method: "DELETE", body: JSON.stringify({ id: "token-1" }) })
      );
    });
    const row = screen.getByText("Desktop planner").closest("li")!;
    expect(within(row).getByText(/Revoked/)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });
});
