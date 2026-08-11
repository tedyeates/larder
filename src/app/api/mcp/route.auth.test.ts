import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "./route";

describe("POST /api/mcp authentication smoke", () => {
  it("rejects missing and malformed Agent Tokens before any database access", async () => {
    const noToken = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    );
    expect(noToken.status).toBe(401);
    await expect(noToken.json()).resolves.toMatchObject({
      error: { code: -32001, message: "Missing Agent Token" },
    });

    const malformedToken = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { authorization: "Bearer malformed" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      })
    );
    expect(malformedToken.status).toBe(401);
    await expect(malformedToken.json()).resolves.toMatchObject({
      error: { code: -32001, message: "Malformed Agent Token" },
    });
  });
});
