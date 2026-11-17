import type { UnitCode } from "@/domain/units";

/** The categories a new account starts with; users can add their own. */
export const DEFAULT_CATEGORIES: readonly { name: string; slug: string; sortOrder: number }[] = [
  { name: "Produce", slug: "produce", sortOrder: 0 },
  { name: "Dairy", slug: "dairy", sortOrder: 1 },
  { name: "Meat", slug: "meat", sortOrder: 2 },
  { name: "Fish", slug: "fish", sortOrder: 3 },
  { name: "Bakery", slug: "bakery", sortOrder: 4 },
  { name: "Dry goods", slug: "dry", sortOrder: 5 },
  { name: "Frozen", slug: "frozen", sortOrder: 6 },
  { name: "Tins", slug: "tins", sortOrder: 7 },
  { name: "Drinks", slug: "drinks", sortOrder: 8 },
  { name: "Other", slug: "other", sortOrder: 9 },
];

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
