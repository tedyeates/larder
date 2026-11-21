import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema notes
 *
 * - `user_id` is on every table from day one, even though there is one user.
 * - Quantities are stored in the ingredient's base unit (g, ml, or its count
 *   unit), as `numeric(14,6)`. The ledger is append-only.
 * - `pantry_balance` is a view: balances are always a sum, never a column.
 */

export const ingredientCategory = pgEnum("ingredient_category", [
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
]);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("categories_user_slug_idx").on(table.userId, table.slug)],
);

export const stockReason = pgEnum("stock_reason", ["purchase", "cook", "adjust", "discard"]);

export const planStatus = pgEnum("plan_status", ["draft", "active", "archived"]);
export const planSlot = pgEnum("plan_slot", ["lunch", "dinner"]);
export const planEntryKind = pgEnum("plan_entry_kind", ["recipe", "leftover"]);
export const planEntryStatus = pgEnum("plan_entry_status", [
  "planned",
  "cooked",
  "eaten",
  "skipped",
]);

export const leftoverStatus = pgEnum("leftover_status", [
  "available",
  "reserved",
  "eaten",
  "discarded",
]);

export const listStatus = pgEnum("list_status", ["open", "done"]);
export const shoppingItemStatus = pgEnum("shopping_item_status", ["pending", "ticked", "removed"]);
export const shoppingItemOrigin = pgEnum("shopping_item_origin", ["generated", "manual"]);
export const creator = pgEnum("creator", ["manual", "agent"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** id from the managed auth server; null until the account first signs in. */
  authUserId: text("auth_user_id").unique(),
  email: text("email"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ingredients = pgTable(
  "ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    categoryId: uuid("category")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    /** The single unit this ingredient is stocked and counted in. */
    stockUnit: text("stock_unit").notNull(),
    /** Grams per unit, for crossing families: { "each": 150, "cup": 120 }. */
    gramsPer: jsonb("grams_per").$type<Record<string, number>>(),
    shelfLifeDays: integer("shelf_life_days"),
    /** Optional low-stock floor, in the stock unit. */
    minStock: numeric("min_stock", { precision: 14, scale: 6, mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ingredients_user_slug_idx").on(table.userId, table.slug),
    index("ingredients_user_category_idx").on(table.userId, table.categoryId),
  ],
);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    servings: integer("servings").notNull().default(2),
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    steps: jsonb("steps").$type<{ text: string; timerMinutes?: number }[]>().notNull().default([]),
    /** Planning instructions for an agent, e.g. "serve with a salad". */
    aiNotes: text("ai_notes"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    imageUrl: text("image_url"),
    createdBy: creator("created_by").notNull().default("manual"),
    rawJsonld: jsonb("raw_jsonld"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("recipes_user_idx").on(table.userId)],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    /** Null until the line is matched to the catalogue. */
    ingredientId: uuid("ingredient_id").references(() => ingredients.id, { onDelete: "set null" }),
    rawText: text("raw_text").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 6, mode: "number" }),
    unit: text("unit"),
    note: text("note"),
    isOptional: boolean("is_optional").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    parseStatus: text("parse_status").notNull().default("unmatched"),
  },
  (table) => [index("recipe_ingredients_recipe_idx").on(table.recipeId, table.sortOrder)],
);

export const mealPlans = pgTable(
  "meal_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    status: planStatus("status").notNull().default("active"),
    createdBy: creator("created_by").notNull().default("manual"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("meal_plans_user_week_idx").on(table.userId, table.weekStart)],
);

export const cookEvents = pgTable(
  "cook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    /** Kept so cook history still reads correctly after the recipe is deleted. */
    recipeLabel: text("recipe_label"),
    planEntryId: uuid("plan_entry_id"),
    portionsCooked: numeric("portions_cooked", { precision: 8, scale: 2, mode: "number" })
      .notNull()
      .default(1),
    eatenNow: numeric("eaten_now", { precision: 8, scale: 2, mode: "number" }).notNull().default(1),
    cookedAt: date("cooked_at", { mode: "string" }).notNull(),
    shortfallCount: integer("shortfall_count").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("cook_events_user_idx").on(table.userId, table.cookedAt)],
);

export const leftovers = pgTable(
  "leftovers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cookEventId: uuid("cook_event_id").references(() => cookEvents.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    portions: numeric("portions", { precision: 8, scale: 2, mode: "number" }).notNull(),
    storedAt: date("stored_at", { mode: "string" }).notNull(),
    bestBefore: date("best_before", { mode: "string" }),
    status: leftoverStatus("status").notNull().default("available"),
  },
  (table) => [index("leftovers_user_status_idx").on(table.userId, table.status)],
);

export const mealPlanEntries = pgTable(
  "meal_plan_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    slot: planSlot("slot").notNull(),
    kind: planEntryKind("kind").notNull().default("recipe"),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    leftoverId: uuid("leftover_id").references(() => leftovers.id, { onDelete: "set null" }),
    portions: numeric("portions", { precision: 8, scale: 2, mode: "number" }).notNull().default(1),
    status: planEntryStatus("status").notNull().default("planned"),
    createdBy: creator("created_by").notNull().default("manual"),
    cookEventId: uuid("cook_event_id").references(() => cookEvents.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("meal_plan_entries_plan_idx").on(table.planId, table.day, table.slot),
    // A slot may hold more than one dish: a main and a side, for example.
  ],
);

export const stockEntries = pgTable(
  "stock_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    /** Signed, in the ingredient's base unit. */
    quantity: numeric("quantity", { precision: 14, scale: 6, mode: "number" }).notNull(),
    unitAsEntered: text("unit_as_entered"),
    quantityAsEntered: numeric("quantity_as_entered", {
      precision: 14,
      scale: 6,
      mode: "number",
    }),
    reason: stockReason("reason").notNull(),
    acquiredAt: date("acquired_at", { mode: "string" }).notNull(),
    bestBefore: date("best_before", { mode: "string" }),
    cookEventId: uuid("cook_event_id").references(() => cookEvents.id, { onDelete: "set null" }),
    shoppingItemId: uuid("shopping_item_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("stock_entries_ingredient_idx").on(table.ingredientId, table.acquiredAt),
    index("stock_entries_user_idx").on(table.userId),
  ],
);

export const shoppingLists = pgTable("shopping_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Shopping"),
  status: listStatus("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const shoppingItems = pgTable(
  "shopping_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id").references(() => ingredients.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 6, mode: "number" }),
    unit: text("unit"),
    note: text("note"),
    /**
     * The human has adjusted this amount (a pack of 3 nests, say). Refreshing
     * the list leaves it alone instead of recalculating the shortfall over it.
     */
    quantityLocked: boolean("quantity_locked").notNull().default(false),
    status: shoppingItemStatus("status").notNull().default("pending"),
    origin: shoppingItemOrigin("origin").notNull().default("manual"),
    tickedAt: timestamp("ticked_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    ticktickTaskId: text("ticktick_task_id"),
    ticktickProjectId: text("ticktick_project_id"),
    resultingStockEntryId: uuid("resulting_stock_entry_id"),
  },
  (table) => [index("shopping_items_list_idx").on(table.listId, table.status)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_log_user_idx").on(table.userId, table.createdAt)],
);

/**
 * Balances are a view over the ledger. Nothing writes a total.
 */
export const pantryBalance = pgView("pantry_balance").as((qb) =>
  qb
    .select({
      ingredientId: stockEntries.ingredientId,
      quantity: sql<number>`sum(${stockEntries.quantity})`.as("quantity"),
    })
    .from(stockEntries)
    .groupBy(stockEntries.ingredientId),
);
