export const MEAL_TIMES = ["breakfast", "lunch", "dinner"] as const;
export type MealTime = (typeof MEAL_TIMES)[number];
export const MEAL_TIME_LABELS: Record<MealTime, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

export type MealPlanLineStatus = {
  recipeLineId: string;
  ingredientName: string;
  status: "available" | "fulfilled_by_substitute" | "missing";
};

export type MealPlanSlot = {
  id: string;
  slotDate: string;
  mealTime: MealTime;
  recipeId: string | null;
  recipeName: string | null;
  label: string | null;
  isCook: boolean;
  cookMultiplier: number;
  cookId: string | null;
  isCookable: boolean | null;
  shortfall: boolean;
  lineStatuses: MealPlanLineStatus[];
};
