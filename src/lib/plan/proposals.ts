import type { SupabaseClient } from "@supabase/supabase-js";
import type { MealTime } from "./types";

type Row = Record<string, unknown>;

export type ProposalSlot = {
  slotDate: string;
  mealTime: MealTime;
  recipeRef?: string;
  recipeId?: string;
  label?: string;
  empty?: boolean;
  keep?: boolean;
  isCook?: boolean;
  cookMultiplier?: number;
};

export type ProposalRecipeLine = {
  ingredientRef?: string;
  ingredientId?: string;
  rawName?: string;
  amount: number;
  unit: string;
  note?: string;
  isEssential?: boolean;
  position?: number;
};

export type ProposalRecipe = {
  ref: string;
  name: string;
  servings: number;
  maxMultiplier?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  source?: string;
  steps?: string;
  tags?: string[];
  lines?: ProposalRecipeLine[];
};

export type ProposalIngredient = {
  ref: string;
  name: string;
  stockUnit: string;
  isHandDepleted?: boolean;
};

export type ProposalAlias = {
  ingredientRef?: string;
  ingredientId?: string;
  alias: string;
};

export type PlanProposalBundle = {
  planningHorizon: string;
  slots: ProposalSlot[];
  newRecipes: ProposalRecipe[];
  newIngredients: ProposalIngredient[];
  suggestedAliases: ProposalAlias[];
};

export type PlanProposal = {
  id: string;
  planningHorizon: string;
  status: "review" | "rejected" | "confirmed";
  rejectionComment: string | null;
  rejectedAt: string | null;
  confirmedAt: string | null;
  bundle: PlanProposalBundle;
  /**
   * Tags for Recipes the bundle's Slots reference by recipeId (already
   * confirmed Recipes), keyed by that id. newRecipes carry their own tags
   * inline; this is only for slots that reuse an existing Recipe, so the
   * review screen can still show Allergen Flags for them.
   */
  existingRecipeTags: Record<string, string[]>;
};

function errorMessage(error: { message: string } | null, fallback: string): string {
  return error?.message ?? fallback;
}

function asBundle(value: unknown): PlanProposalBundle {
  const bundle = (value ?? {}) as Row;
  return {
    planningHorizon: String(bundle.planningHorizon ?? ""),
    slots: Array.isArray(bundle.slots) ? bundle.slots as ProposalSlot[] : [],
    newRecipes: Array.isArray(bundle.newRecipes) ? bundle.newRecipes as ProposalRecipe[] : [],
    newIngredients: Array.isArray(bundle.newIngredients) ? bundle.newIngredients as ProposalIngredient[] : [],
    suggestedAliases: Array.isArray(bundle.suggestedAliases) ? bundle.suggestedAliases as ProposalAlias[] : [],
  };
}

function toProposal(row: Row, existingRecipeTags: Record<string, string[]>): PlanProposal {
  return {
    id: row.id as string,
    planningHorizon: row.planning_horizon as string,
    status: row.status as PlanProposal["status"],
    rejectionComment: (row.rejection_comment as string | null) ?? null,
    rejectedAt: (row.rejected_at as string | null) ?? null,
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    bundle: asBundle(row.bundle),
    existingRecipeTags,
  };
}

/** Reads only review history belonging to current browser user. Draft rows stay out of every ordinary plan/recipe read. */
export async function listPlanProposals(client: SupabaseClient): Promise<PlanProposal[]> {
  const { data, error } = await client
    .from("plan_proposals")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(errorMessage(error, "Failed to load Plan Proposals"));
  const rows = (data ?? []) as Row[];

  // Slots may point at an already-confirmed Recipe by id instead of a
  // proposed newRecipes ref. Those Recipes' Tags live outside the bundle, so
  // the review screen still needs them to show Allergen Flags for reused
  // Recipes, not only newly proposed ones.
  const recipeIds = new Set<string>();
  for (const row of rows) {
    const bundle = asBundle(row.bundle);
    for (const slot of bundle.slots) {
      if (slot.recipeId) recipeIds.add(slot.recipeId);
    }
  }

  const tagsByRecipe: Record<string, string[]> = {};
  if (recipeIds.size > 0) {
    const { data: tagRows, error: tagError } = await client
      .from("recipe_tags")
      .select("recipe_id, tag")
      .in("recipe_id", Array.from(recipeIds));
    if (tagError) throw new Error(errorMessage(tagError, "Failed to load Recipe Tags"));
    for (const tagRow of (tagRows ?? []) as Row[]) {
      const recipeId = tagRow.recipe_id as string;
      (tagsByRecipe[recipeId] ??= []).push(tagRow.tag as string);
    }
  }

  return rows.map((row) => toProposal(row, tagsByRecipe));
}

/** Human-only confirmation: database rejects Agent Token sessions even when they share this user's RLS subject. */
export async function confirmPlanProposal(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc("confirm_plan_proposal", { p_proposal_id: id });
  if (error) throw new Error(errorMessage(error, "Failed to confirm Plan Proposal"));
}

export async function rejectPlanProposal(client: SupabaseClient, id: string, comment: string): Promise<void> {
  const { error } = await client.rpc("reject_plan_proposal", { p_proposal_id: id, p_comment: comment });
  if (error) throw new Error(errorMessage(error, "Failed to reject Plan Proposal"));
}
