"use client";

import { useEffect, useState } from "react";
import { PlanProposalReview } from "@/components/plan-proposal-review";
import { createClient } from "@/lib/supabase/client";
import {
  confirmPlanProposal,
  listPlanProposals,
  rejectPlanProposal,
  type PlanProposal,
} from "@/lib/plan/proposals";

type LoadState = "loading" | "loaded" | "error";

/** Dedicated human review boundary for AI Plan Proposal bundles. */
export default function PlanProposalReviewPage() {
  const [proposals, setProposals] = useState<PlanProposal[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setState("loading");
    setError(null);
    try {
      setProposals(await listPlanProposals(createClient()));
      setState("loaded");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Plan Proposals");
      setState("error");
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function run(action: () => Promise<void>) {
    try {
      setError(null);
      await action();
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Plan Proposal action failed");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Plan Proposals</h1>
        <p className="mt-1 text-sm text-foreground/60">Review every AI-proposed Slot, Recipe, Ingredient and Alias before it changes your plan.</p>
      </div>
      {state === "loading" ? <p className="text-sm text-foreground/60">Loading Plan Proposals…</p> : null}
      {state === "error" ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {state === "loaded" && proposals.every((proposal) => proposal.status !== "review") ? <p className="text-sm text-foreground/60">No Plan Proposals awaiting review.</p> : null}
      {state === "loaded" ? <PlanProposalReview proposals={proposals} onConfirm={(id) => run(() => confirmPlanProposal(createClient(), id))} onReject={(id, comment) => run(() => rejectPlanProposal(createClient(), id, comment))} /> : null}
    </div>
  );
}
