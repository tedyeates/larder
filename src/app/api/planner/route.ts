import { NextResponse } from "next/server";
import { agentRunnerUrl } from "@/lib/planner/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlannerRequest = {
  message?: unknown;
  planningHorizon?: unknown;
  conversationId?: unknown;
  proposalId?: unknown;
};

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be non-blank text`);
  return value.trim();
}

function requestBody(input: PlannerRequest) {
  const message = optionalText(input.message, "message");
  if (!message) throw new Error("message must be non-blank text");
  if (message.length > 10_000) throw new Error("message is too long");
  const planningHorizon = optionalText(input.planningHorizon, "planningHorizon");
  if (planningHorizon && !/^\d{4}-\d{2}-\d{2}$/.test(planningHorizon)) throw new Error("planningHorizon must be YYYY-MM-DD");
  const conversationId = optionalText(input.conversationId, "conversationId");
  const proposalId = optionalText(input.proposalId, "proposalId");
  return { message, ...(planningHorizon ? { planningHorizon } : {}), ...(conversationId ? { conversationId } : {}), ...(proposalId ? { proposalId } : {}) };
}

/**
 * Same-origin streaming relay. Browser code never learns Runner address; any
 * container implementing POST /v1/chat with SSE can replace kiro-cli.
 */
export async function POST(request: Request) {
  const runnerUrl = agentRunnerUrl();
  if (!runnerUrl) return NextResponse.json({ error: "Planning is unavailable on this deployment." }, { status: 404 });

  let input: ReturnType<typeof requestBody>;
  try {
    input = requestBody((await request.json()) as PlannerRequest);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid planner request" }, { status: 400 });
  }

  let runnerResponse: Response;
  try {
    runnerResponse = await fetch(`${runnerUrl}/v1/chat`, {
      method: "POST",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Planner is unavailable. Check the Agent Runner connection." }, { status: 502 });
  }

  if (!runnerResponse.ok || !runnerResponse.body) {
    return NextResponse.json(
      { error: `Planner is unavailable. Agent Runner returned ${runnerResponse.status}.` },
      { status: 502 }
    );
  }

  return new Response(runnerResponse.body, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": runnerResponse.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
