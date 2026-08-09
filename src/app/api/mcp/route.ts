import { NextResponse } from "next/server";
import {
  AgentTokenAuthenticationError,
  callAgentGatewayTool,
  listAgentGatewayTools,
  McpToolError,
} from "@/lib/agent-gateway/gateway";
import { isAgentTokenSecret } from "@/lib/agent-gateway/tokens";

export const runtime = "nodejs";

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

function responseId(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function rpcError(id: unknown, status: number, code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: responseId(id), error: { code, message } },
    { status }
  );
}

function rpcResult(id: unknown, result: Record<string, unknown>) {
  return NextResponse.json({ jsonrpc: "2.0", id: responseId(id), result });
}

function bearerToken(request: Request):
  | { token: string }
  | { error: { status: number; code: number; message: string } } {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return { error: { status: 401, code: -32001, message: "Missing Agent Token" } };
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match || !isAgentTokenSecret(match[1])) {
    return { error: { status: 401, code: -32001, message: "Malformed Agent Token" } };
  }
  return { token: match[1] };
}

function toolCall(params: unknown): { name: string; argumentsValue: unknown } | McpToolError {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return new McpToolError(400, "tools/call requires params");
  }
  const value = params as Record<string, unknown>;
  if (typeof value.name !== "string" || value.name.trim() === "") {
    return new McpToolError(400, "tools/call requires a tool name");
  }
  return { name: value.name, argumentsValue: value.arguments ?? {} };
}

function isToolCall(value: { name: string; argumentsValue: unknown } | McpToolError): value is {
  name: string;
  argumentsValue: unknown;
} {
  return !(value instanceof McpToolError);
}

/**
 * MCP Streamable HTTP endpoint. Auth applies before tool discovery and every
 * call; browser sessions and Supabase keys are never accepted here.
 */
export async function POST(request: Request) {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, 400, -32700, "Invalid JSON");
  }

  if (body.jsonrpc !== "2.0") {
    return rpcError(body.id, 400, -32600, "Expected JSON-RPC 2.0 request");
  }

  const credential = bearerToken(request);
  if ("error" in credential) {
    return rpcError(body.id, credential.error.status, credential.error.code, credential.error.message);
  }

  try {
    switch (body.method) {
      case "initialize":
        // Authenticate initialize as well, rather than letting a caller probe
        // the private server surface without an Agent Token.
        await listAgentGatewayTools(credential.token);
        return rpcResult(body.id, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "larder-agent-gateway", version: "1" },
        });
      case "tools/list":
        return rpcResult(body.id, await listAgentGatewayTools(credential.token));
      case "tools/call": {
        const call = toolCall(body.params);
        if (!isToolCall(call)) {
          return rpcError(body.id, call.status, -32602, call.message);
        }
        const structuredContent = await callAgentGatewayTool(
          credential.token,
          call.name,
          call.argumentsValue
        );
        return rpcResult(body.id, {
          content: [{ type: "text", text: JSON.stringify(structuredContent) }],
          structuredContent,
        });
      }
      default:
        return rpcError(body.id, 400, -32601, "Unknown MCP method");
    }
  } catch (error) {
    if (error instanceof AgentTokenAuthenticationError) {
      return rpcError(body.id, 401, -32001, error.message);
    }
    if (error instanceof McpToolError) {
      return rpcError(body.id, error.status, error.status === 403 ? -32003 : -32602, error.message);
    }
    return rpcError(body.id, 500, -32603, "Agent Gateway failed");
  }
}
