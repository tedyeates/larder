import type { UnitCode } from "@/domain/units";

export const CATEGORIES = [
  "produce",
  "dairy",
  "meat",
  "fish",
  "bakery",
  "dry",
  "frozen",
  "tins",
  "drinks",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  produce: "Produce",
  dairy: "Dairy",
  meat: "Meat",
  fish: "Fish",
  bakery: "Bakery",
  dry: "Dry goods",
  frozen: "Frozen",
  tins: "Tins",
  drinks: "Drinks",
  other: "Other",
};

/** Units offered when creating an ingredient inline. */
export const CREATE_UNITS: readonly UnitCode[] = [
  "g",
  "kg",
  "ml",
  "l",
  "each",
  "can",
  "pack",
  "bunch",
  "clove",
  "slice",
  "head",
  "fillet",
  "rasher",
  "sprig",
];
