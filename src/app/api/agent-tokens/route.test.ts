import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from }),
}));

import { DELETE, GET, POST } from "./route";
import { hashAgentToken } from "@/lib/agent-gateway/tokens";

const mintedRow = {
  id: "token-1",
  label: "Desktop planner",
  created_at: "2026-08-09T10:00:00Z",
  revoked_at: null,
};

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/agent-tokens", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("Agent Token Settings API", () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    from.mockReset();
  });

  it("mints a one-time secret while inserting only its hash", async () => {
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: mintedRow, error: null }) }),
    });
    from.mockReturnValue({ insert });

    const response = await POST(request("POST", { label: "Desktop planner" }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { token: string; agentToken: Record<string, unknown> };

    expect(body.token).toMatch(/^agt_[A-Za-z0-9_-]{43}$/);
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      label: "Desktop planner",
      token_hash: hashAgentToken(body.token),
    });
    expect(insert.mock.calls[0][0].token_hash).not.toBe(body.token);
    expect(body.agentToken).not.toHaveProperty("token_hash");
  });

  it("lists metadata without a recoverable token secret", async () => {
    const order = vi.fn().mockResolvedValue({ data: [mintedRow], error: null });
    const select = vi.fn().mockReturnValue({ order });
    from.mockReturnValue({ select });

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tokens: [{ id: "token-1", label: "Desktop planner", createdAt: "2026-08-09T10:00:00Z", revokedAt: null }],
    });
    expect(select).toHaveBeenCalledWith("id, label, created_at, revoked_at");
  });

  it("revokes only an active token", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { ...mintedRow, revoked_at: "2026-08-09T11:00:00Z" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const is = vi.fn().mockReturnValue({ select });
    const eq = vi.fn().mockReturnValue({ is });
    const update = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ update });

    const response = await DELETE(request("DELETE", { id: "token-1" }));
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ revoked_at: expect.any(String) }));
    expect(eq).toHaveBeenCalledWith("id", "token-1");
    expect(is).toHaveBeenCalledWith("revoked_at", null);
    await expect(response.json()).resolves.toMatchObject({
      agentToken: { id: "token-1", revokedAt: "2026-08-09T11:00:00Z" },
    });
  });
});
