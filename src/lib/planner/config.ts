/** Server-only capability switch. Keep this URL out of NEXT_PUBLIC_* so browsers
 * only ever speak to the app relay, never directly to a Runner. */
export function agentRunnerUrl(): string | null {
  const value = process.env.AGENT_RUNNER_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function isAgentRunnerConfigured(): boolean {
  return agentRunnerUrl() !== null;
}
