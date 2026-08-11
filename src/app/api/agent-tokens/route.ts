import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashAgentToken, mintAgentTokenSecret } from "@/lib/agent-gateway/tokens";

export const runtime = "nodejs";

type TokenRow = {
  id: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
};

function publicToken(row: TokenRow) {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

async function authenticatedClient() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { client, user: data.user };
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Lists metadata only. Raw Agent Token secrets are intentionally never listable. */
export async function GET() {
  const context = await authenticatedClient();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data, error } = await context.client
    .from("agent_tokens")
    .select("id, label, created_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to load Agent Tokens" }, { status: 500 });

  return NextResponse.json({ tokens: ((data ?? []) as TokenRow[]).map(publicToken) });
}

/** Mints a random secret once; only its SHA-256 hash is inserted into Postgres. */
export async function POST(request: Request) {
  const context = await authenticatedClient();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await jsonBody(request);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });
  if (label.length > 120) return NextResponse.json({ error: "Label is too long" }, { status: 400 });

  const secret = mintAgentTokenSecret();
  const { data, error } = await context.client
    .from("agent_tokens")
    .insert({ user_id: context.user.id, label, token_hash: hashAgentToken(secret) })
    .select("id, label, created_at, revoked_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "Failed to mint Agent Token" }, { status: 500 });

  // `token` appears only in this response. GET never returns it and no raw
  // secret is persisted, so a page reload cannot recover it.
  return NextResponse.json({ token: secret, agentToken: publicToken(data as TokenRow) }, { status: 201 });
}

/** Revocation is an update, not deletion, so a leaked token remains rejectable forever. */
export async function DELETE(request: Request) {
  const context = await authenticatedClient();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await jsonBody(request);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Agent Token id is required" }, { status: 400 });

  const { data, error } = await context.client
    .from("agent_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null)
    .select("id, label, created_at, revoked_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to revoke Agent Token" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Agent Token not found or already revoked" }, { status: 404 });

  return NextResponse.json({ agentToken: publicToken(data as TokenRow) });
}
