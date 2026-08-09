"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

type ChatMessage = { id: string; role: "user" | "assistant"; text: string };
type RunnerEvent = { event: string; data: string };

function weekOut(): string {
  return new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
}

function conversationKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `planner-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function eventsFrom(buffer: string): { events: RunnerEvent[]; remainder: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const remainder = parts.pop() ?? "";
  const events = parts.map((part) => {
    const lines = part.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    return { event, data };
  }).filter((item) => item.data !== "");
  return { events, remainder };
}

function eventData(data: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : { text: data };
  } catch {
    return { text: data };
  }
}

function readableError(response: Response, body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  return `Planner request failed (${response.status}).`;
}

/** Chat panel consumes generic Runner SSE, not a kiro-cli-specific protocol. */
export function PlannerChat() {
  const [planningHorizon, setPlanningHorizon] = useState(weekOut);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId] = useState(conversationKey);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const canSend = useMemo(() => message.trim().length > 0 && !sending, [message, sending]);

  async function receive(event: RunnerEvent, assistantId: string) {
    const value = eventData(event.data);
    if (event.event === "token" || event.event === "message") {
      const text = typeof value.text === "string" ? value.text : "";
      if (text) setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, text: item.text + text } : item));
      return;
    }
    if (event.event === "proposal" && typeof value.proposalId === "string") setProposalId(value.proposalId);
    if (event.event === "error") setError(typeof value.error === "string" ? value.error : "Planner stopped before completing its reply.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setMessage("");
    setError(null);
    setSending(true);
    const assistantId = `assistant-${Date.now()}`;
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", text }, { id: assistantId, role: "assistant", text: "" }]);
    try {
      const response = await fetch("/api/planner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, planningHorizon, conversationId, ...(proposalId ? { proposalId } : {}) }),
      });
      if (!response.ok) {
        let body: unknown = null;
        try { body = await response.json(); } catch { /* response has no JSON error body */ }
        throw new Error(readableError(response, body));
      }
      if (!response.body) throw new Error("Planner sent no reply.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const parsed = eventsFrom(buffer);
        buffer = parsed.remainder;
        for (const runnerEvent of parsed.events) await receive(runnerEvent, assistantId);
        if (done) break;
      }
      if (buffer.trim()) await receive({ event: "token", data: buffer }, assistantId);
    } catch (requestError) {
      setMessages((current) => current.filter((item) => item.id !== assistantId || item.text !== ""));
      setError(requestError instanceof Error ? requestError.message : "Planner request failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-label="Planner chat" className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Planner</h1>
        <p className="mt-1 text-sm text-foreground/60">Discuss meals, then review any submitted Plan Proposal before it changes your plan.</p>
      </div>
      <div aria-live="polite" className="space-y-3 rounded-md border border-foreground/10 p-4">
        {messages.length === 0 ? <p className="text-sm text-foreground/60">Ask for a plan, then revise it until it fits.</p> : null}
        {messages.map((item) => <article key={item.id} className={item.role === "user" ? "rounded bg-foreground/5 p-3" : "rounded border border-foreground/10 p-3"}>
          <h2 className="text-xs font-semibold uppercase text-foreground/60">{item.role === "user" ? "You" : "Planner"}</h2>
          <p className="whitespace-pre-wrap text-sm">{item.text || (sending && item.role === "assistant" ? "Thinking…" : "")}</p>
        </article>)}
      </div>
      {proposalId ? <Link href="/plan/review" className="inline-block rounded border border-foreground/20 px-3 py-2 text-sm">Review proposal</Link> : null}
      <form onSubmit={submit} className="space-y-3 rounded-md border border-foreground/10 p-4">
        <label className="block text-sm font-medium">Plan through
          <input aria-label="Plan through" type="date" min={new Date().toISOString().slice(0, 10)} value={planningHorizon} onChange={(event) => setPlanningHorizon(event.target.value)} className="mt-1 block rounded border border-foreground/20 bg-transparent px-2 py-1" />
        </label>
        <label className="block text-sm font-medium">Message
          <textarea aria-label="Message" required value={message} onChange={(event) => setMessage(event.target.value)} className="mt-1 block min-h-24 w-full rounded border border-foreground/20 bg-transparent p-2" placeholder="Plan dinners that use what we have." />
        </label>
        <button type="submit" disabled={!canSend} className="rounded bg-foreground px-3 py-2 text-sm text-background">{sending ? "Planning…" : "Send"}</button>
      </form>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
