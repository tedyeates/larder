"use client";

import { useState } from "react";
import { allergenFlagsFromTags } from "@/lib/recipes/recipes";
import type { PlanProposal } from "@/lib/plan/proposals";

type Props = {
  proposals: PlanProposal[];
  onConfirm: (id: string) => Promise<void>;
  onReject: (id: string, comment: string) => Promise<void>;
};

/** Whole-bundle human review. Proposal drafts are deliberately shown here and nowhere in ordinary reads. */
export function PlanProposalReview({ proposals, onConfirm, onReject }: Props) {
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<void>) {
    setBusy(id);
    try { await action(); } finally { setBusy(null); }
  }

  const reviewable = proposals.filter((proposal) => proposal.status === "review");
  if (reviewable.length === 0) return null;

  return (
    <section aria-label="Plan Proposal review" className="space-y-4 rounded-md border border-foreground/20 p-4">
      <div>
        <h2 className="text-lg font-semibold">Plan Proposal review</h2>
        <p className="text-sm text-foreground/60">Confirm writes Shopping once. Reject sends comments back to Runner.</p>
      </div>
      {reviewable.map((proposal) => (
        <article key={proposal.id} className="space-y-4 rounded border border-foreground/10 p-3">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Through {proposal.planningHorizon}</h3>
            <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">Awaiting confirmation</span>
          </header>
          <div className="grid gap-3 md:grid-cols-2">
            <section aria-label="Proposed Meal Slots">
              <h4 className="text-sm font-semibold">Meal Slots</h4>
              <ul className="text-sm">
                {proposal.bundle.slots.map((slot, index) => {
                  const existingAllergens = slot.recipeId
                    ? allergenFlagsFromTags(proposal.existingRecipeTags[slot.recipeId] ?? [])
                    : [];
                  return (
                    <li key={`${slot.slotDate}-${slot.mealTime}-${index}`}>
                      {slot.slotDate} {slot.mealTime}: {slot.keep ? "Keep current" : slot.empty ? "Explicitly empty" : slot.recipeRef ?? slot.recipeId ?? slot.label ?? "Unfilled"}
                      {slot.isCook ? ` · Cook ×${slot.cookMultiplier ?? 1}` : ""}
                      {slot.recipeId ? ` · Allergen Flags: ${existingAllergens.length ? existingAllergens.join(", ") : "None"}` : ""}
                    </li>
                  );
                })}
              </ul>
            </section>
            <section aria-label="New Ingredients and Aliases">
              <h4 className="text-sm font-semibold">New Ingredients</h4>
              <ul className="text-sm">{proposal.bundle.newIngredients.map((ingredient) => <li key={ingredient.ref}>{ingredient.name} ({ingredient.stockUnit})</li>)}</ul>
              <h4 className="mt-2 text-sm font-semibold">Suggested Aliases</h4>
              <ul className="text-sm">{proposal.bundle.suggestedAliases.map((alias, index) => <li key={`${alias.alias}-${index}`}>{alias.alias}</li>)}</ul>
            </section>
          </div>
          <section aria-label="New Recipes">
            <h4 className="text-sm font-semibold">New Recipes</h4>
            {proposal.bundle.newRecipes.map((recipe) => {
              const allergens = allergenFlagsFromTags(recipe.tags ?? []);
              return <div key={recipe.ref} className="mt-2 rounded bg-foreground/5 p-2 text-sm">
                <strong>{recipe.name}</strong> · {recipe.servings} servings · max ×{recipe.maxMultiplier ?? 1}
                <p>Allergen Flags: {allergens.length ? allergens.join(", ") : "None"}</p>
                <ul>{(recipe.lines ?? []).map((line, index) => <li key={`${line.ingredientRef ?? line.ingredientId}-${index}`}>{line.amount} {line.unit} {line.ingredientRef ?? line.ingredientId ?? line.rawName}</li>)}</ul>
              </div>;
            })}
          </section>
          <label className="block text-sm font-medium">Rejection comments
            <textarea aria-label={`Rejection comments for ${proposal.id}`} value={comments[proposal.id] ?? ""} onChange={(event) => setComments((current) => ({ ...current, [proposal.id]: event.target.value }))} className="mt-1 block w-full rounded border p-2" />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy === proposal.id} onClick={() => run(proposal.id, () => onConfirm(proposal.id))} className="rounded bg-foreground px-3 py-2 text-sm text-background">Confirm plan</button>
            <button type="button" disabled={busy === proposal.id} onClick={() => run(proposal.id, () => onReject(proposal.id, comments[proposal.id] ?? ""))} className="rounded border px-3 py-2 text-sm">Reject with comments</button>
          </div>
        </article>
      ))}
    </section>
  );
}
