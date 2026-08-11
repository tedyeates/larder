"use client";

import { useEffect, useState, type FormEvent } from "react";

type AgentToken = {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
};

type LoadState = "loading" | "loaded" | "error";

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Agent Tokens belong in settings because an Agent Runner is configured by a
 * user, not by the container. Token metadata stays visible for revocation;
 * the secret has no recovery path after this component unmounts.
 */
export function AgentTokensPanel() {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function refresh() {
    setLoadState("loading");
    setLoadError(null);
    try {
      const response = await fetch("/api/agent-tokens");
      if (!response.ok) throw new Error(await responseError(response, "Failed to load Agent Tokens"));
      const body = (await response.json()) as { tokens?: AgentToken[] };
      setTokens(body.tokens ?? []);
      setLoadState("loaded");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load Agent Tokens");
      setLoadState("error");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleMint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setActionError(null);
    setSecret(null);
    try {
      const response = await fetch("/api/agent-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Failed to mint Agent Token"));
      const body = (await response.json()) as { token?: string; agentToken?: AgentToken };
      if (!body.token || !body.agentToken) throw new Error("Agent Token response was incomplete");
      setSecret(body.token);
      setTokens((current) => [body.agentToken!, ...current]);
      setLabel("");
      setLoadState("loaded");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to mint Agent Token");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    setActionError(null);
    try {
      const response = await fetch("/api/agent-tokens", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Failed to revoke Agent Token"));
      const body = (await response.json()) as { agentToken?: AgentToken };
      if (!body.agentToken) throw new Error("Agent Token response was incomplete");
      setTokens((current) => current.map((token) => (token.id === id ? body.agentToken! : token)));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to revoke Agent Token");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="space-y-4 border-t border-foreground/10 pt-6" aria-labelledby="agent-tokens-heading">
      <div>
        <h2 id="agent-tokens-heading" className="text-lg font-semibold">
          Agent Tokens
        </h2>
        <p className="mt-1 text-sm text-foreground/60">
          Give one to an Agent Runner so it can read your Larder through MCP. It is never a database
          credential. Copy a new secret now; it cannot be shown again.
        </p>
      </div>

      <form onSubmit={handleMint} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <label htmlFor="agent-token-label" className="text-xs font-medium text-foreground/60">
            Token label
          </label>
          <input
            id="agent-token-label"
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Kitchen planner on desktop"
            className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {submitting ? "Minting…" : "Mint Agent Token"}
        </button>
      </form>

      {secret ? (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Copy this Agent Token now. It will not be shown again.</p>
          <code data-testid="agent-token-secret" className="mt-2 block break-all rounded bg-background/70 p-2">
            {secret}
          </code>
        </div>
      ) : null}

      {loadState === "loading" ? <p className="text-sm text-foreground/60">Loading Agent Tokens…</p> : null}
      {loadState === "error" ? <p role="alert" className="text-sm text-red-600">{loadError}</p> : null}
      {loadState === "loaded" && tokens.length === 0 ? (
        <p data-testid="agent-tokens-empty" className="text-sm text-foreground/60">
          No Agent Tokens yet.
        </p>
      ) : null}
      {loadState === "loaded" && tokens.length > 0 ? (
        <ul className="divide-y divide-foreground/10">
          {tokens.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm">{token.label}</p>
                <p className="text-xs text-foreground/60">
                  {token.revokedAt ? "Revoked" : "Active"} · minted {new Date(token.createdAt).toLocaleDateString()}
                </p>
              </div>
              {token.revokedAt ? null : (
                <button
                  type="button"
                  disabled={revokingId === token.id}
                  onClick={() => void handleRevoke(token.id)}
                  className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-600 disabled:opacity-50"
                >
                  {revokingId === token.id ? "Revoking…" : "Revoke"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {actionError ? <p role="alert" className="text-sm text-red-600">{actionError}</p> : null}
    </section>
  );
}
