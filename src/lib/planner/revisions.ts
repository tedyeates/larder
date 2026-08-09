function errorText(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  return `Planner request failed (${status}).`;
}

/** Sends review feedback through the same public relay and waits for the
 * Runner to finish its MCP resubmission. A missing Runner is an expected
 * hosted-deployment mode, so rejection remains a deterministic local action. */
export async function notifyPlannerOfRejectedProposal(proposalId: string, comment: string): Promise<boolean> {
  const message = `Plan Proposal ${proposalId} was rejected. Reviewer comments: ${comment.trim() || "No comment supplied"}. Revise the proposal, then resubmit it with this proposalId.`;
  const response = await fetch("/api/planner", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, proposalId }),
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    let body: unknown = null;
    try { body = await response.json(); } catch { /* no structured error */ }
    throw new Error(errorText(body, response.status));
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Planner sent no reply.");
  while (!(await reader.read()).done) {
    // Drain SSE so the Runner remains connected until it submits the revision.
  }
  return true;
}
