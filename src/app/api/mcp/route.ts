import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { buildLarderServer } from "@/lib/mcp/server";

/**
 * Stateless Streamable HTTP MCP endpoint.
 *
 * No session ID and JSON responses: every call stands alone, which is what a
 * serverless function can actually support. Auth is a single bearer token held
 * server-side; the agent never sees the database URL.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVER_HEADER = { "x-larder-mcp": "0.1.0" };

async function handle(request: Request): Promise<Response> {
  const expected = process.env.LARDER_MCP_TOKEN;
  if (!expected) {
    return Response.json(
      { error: "Larder MCP is not configured." },
      { status: 503, headers: SERVER_HEADER },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // Length-safe comparison is overkill for a personal token, but avoid early exit.
  if (token.length !== expected.length || token !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: SERVER_HEADER });
  }

  const [owner] = await getDb().select({ id: users.id }).from(users).limit(1);
  if (!owner) {
    return Response.json(
      { error: "No Larder owner yet." },
      { status: 503, headers: SERVER_HEADER },
    );
  }

  const server = buildLarderServer(owner.id);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    keepAliveMs: 0,
  });

  await server.connect(transport);
  return transport.handleRequest(request, {
    authInfo: { token, clientId: "larder-agent", scopes: ["read"] },
  });
}

export { handle as GET, handle as POST, handle as DELETE, handle as OPTIONS };
