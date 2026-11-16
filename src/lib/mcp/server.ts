import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import {
  ingredients,
  mealPlanEntries,
  mealPlans,
  recipeIngredients,
  recipes,
  stockEntries,
} from "@/db/schema";
import { daysBetween } from "@/domain/dates";
import { balance } from "@/domain/ledger";
import { diffAgainstPantry, planRequirements } from "@/domain/plan";
import { assertUnitCode, isUnitCode, toBase, type UnitCode } from "@/domain/units";
import { CATEGORIES } from "@/lib/ingredient-options";
import { getPantryRows } from "@/lib/pantry";
import { currentWeek, ensurePlan, listLeftovers, loadWeek } from "@/lib/plan";
import { slugify } from "@/lib/slug";

const INSTRUCTIONS = `Larder is a deterministic pantry and meal-planning ledger.

Rules that matter:
- Balances are sums over an append-only ledger. Never invent or adjust a number.
- Quantities live in each ingredient's stock unit. If a recipe unit can't be
  converted, say so and ask; never guess a weight or a volume.
- Cooking deducts oldest-first. Plans are proposals until the human cooks.
- Leftovers are already-cooked portions: assigning one to a meal deducts nothing.
- Prefer stock that is close to its best-before date.
- You may propose a week with create_meal_plan. It is saved as a draft: the human
  must activate it before it affects shopping or cooking.
- When the library has nothing suitable, source a recipe from the web, present it
  with its source link, and only save it after the human agrees. Resolve ingredient
  names with list_ingredients first; create_ingredient for anything genuinely new.

You cannot cook, tick shopping items, or adjust stock. The human confirms reality.`;

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function buildLarderServer(userId: string): McpServer {
  const server = new McpServer(
    { name: "larder", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "list_pantry",
    {
      title: "List pantry",
      description:
        "Every ingredient in stock with its balance, unit, status (Out/Low/Use soon/OK) and best-before date.",
      inputSchema: {
        query: z.string().optional().describe("Filter by ingredient name"),
        include_empty: z.boolean().optional().describe("Include ingredients at zero"),
      },
    },
    async ({ query, include_empty }) => {
      const rows = await getPantryRows(userId);
      const needle = query?.trim().toLowerCase();
      const filtered = rows.filter(
        (row) =>
          (include_empty === true || row.onHand > 0) &&
          (needle === undefined || needle === "" || row.name.toLowerCase().includes(needle)),
      );
      return text(
        filtered.map((row) => ({
          ingredient: row.name,
          amount: row.display,
          status: row.status,
          use_by: row.earliestBestBefore,
        })),
      );
    },
  );

  server.registerTool(
    "expiring_soon",
    {
      title: "Expiring soon",
      description: "Stock that is closest to its best-before date, oldest first.",
      inputSchema: {
        within_days: z.number().int().min(0).max(60).optional(),
      },
    },
    async ({ within_days }) => {
      const days = within_days ?? 3;
      const rows = await getPantryRows(userId);
      return text(
        rows
          .filter(
            (row) => row.onHand > 0 && row.daysUntilExpiry !== null && row.daysUntilExpiry <= days,
          )
          .sort((a, b) => (a.daysUntilExpiry ?? 0) - (b.daysUntilExpiry ?? 0))
          .map((row) => ({
            ingredient: row.name,
            amount: row.display,
            days_until: row.daysUntilExpiry,
            use_by: row.earliestBestBefore,
          })),
      );
    },
  );

  server.registerTool(
    "list_leftovers",
    {
      title: "List leftovers",
      description: "Cooked portions waiting to be eaten, with their use-by date.",
      inputSchema: {},
    },
    async () => text(await listLeftovers(userId)),
  );

  server.registerTool(
    "get_week_plan",
    {
      title: "Get week plan",
      description: "The meals planned for a week (Monday-anchored). Defaults to this week.",
      inputSchema: {
        week_start: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Monday of the week, YYYY-MM-DD"),
      },
    },
    async ({ week_start }) => {
      const week = week_start ?? currentWeek();
      const view = await loadWeek(userId, week);
      return text({
        week,
        entries: view.entries.map((entry) => ({
          day: entry.day,
          slot: entry.slot,
          kind: entry.kind,
          title: entry.title,
          portions: entry.portions,
          status: entry.status,
        })),
      });
    },
  );

  server.registerTool(
    "search_recipes",
    {
      title: "Search recipes",
      description: "Find recipes by title. Returns id, title and servings.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit }) => {
      const needle = query?.trim().toLowerCase();
      const rows = await getDb()
        .select({ id: recipes.id, title: recipes.title, servings: recipes.servings })
        .from(recipes)
        .where(eq(recipes.userId, userId));
      const filtered = rows
        .filter(
          (row) =>
            needle === undefined || needle === "" || row.title.toLowerCase().includes(needle),
        )
        .slice(0, limit ?? 20);
      return text(filtered);
    },
  );

  server.registerTool(
    "get_recipe",
    {
      title: "Get recipe",
      description: "Full recipe including ingredient lines in catalogue names and units.",
      inputSchema: { recipe_id: z.uuid() },
    },
    async ({ recipe_id }) => {
      const db = getDb();
      const [recipe] = await db
        .select()
        .from(recipes)
        .where(and(eq(recipes.id, recipe_id), eq(recipes.userId, userId)))
        .limit(1);
      if (!recipe) return text({ error: "Recipe not found" });

      const lines = await db
        .select({
          raw: recipeIngredients.rawText,
          quantity: recipeIngredients.quantity,
          unit: recipeIngredients.unit,
          ingredient: ingredients.name,
          stockUnit: ingredients.stockUnit,
        })
        .from(recipeIngredients)
        .leftJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
        .where(eq(recipeIngredients.recipeId, recipe.id))
        .orderBy(recipeIngredients.sortOrder);

      return text({
        id: recipe.id,
        title: recipe.title,
        servings: recipe.servings,
        steps: recipe.steps,
        ingredients: lines,
      });
    },
  );

  server.registerTool(
    "propose_shopping_list",
    {
      title: "Propose shopping list",
      description:
        "What a week's planned meals need beyond the pantry. Read-only: writes nothing to the list.",
      inputSchema: {
        week_start: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      },
    },
    async ({ week_start }) => {
      const week = week_start ?? currentWeek();
      const db = getDb();
      const view = await loadWeek(userId, week);
      const meals = view.entries
        .filter((entry) => entry.kind === "recipe" && entry.status === "planned" && entry.recipeId)
        .map((entry) => ({ recipeId: entry.recipeId as string, portions: entry.portions }));

      if (meals.length === 0) return text({ week, items: [] });

      const recipeIds = [...new Set(meals.map((meal) => meal.recipeId))];
      const [recipeRows, lineRows, catalogue, lots] = await Promise.all([
        db.select().from(recipes).where(eq(recipes.userId, userId)),
        db.select().from(recipeIngredients),
        db.select().from(ingredients).where(eq(ingredients.userId, userId)),
        db.select().from(stockEntries).where(eq(stockEntries.userId, userId)),
      ]);

      const ingredientMap = new Map(
        catalogue.map((item) => [
          item.id,
          {
            id: item.id,
            name: item.name,
            stockUnit: item.stockUnit as UnitCode,
            gramsPer: item.gramsPer ?? undefined,
          },
        ]),
      );

      const recipeMap = new Map(
        recipeRows
          .filter((recipe) => recipeIds.includes(recipe.id))
          .map((recipe) => [
            recipe.id,
            {
              servings: recipe.servings,
              lines: lineRows
                .filter((line) => line.recipeId === recipe.id)
                .map((line) => ({
                  ingredientId: line.ingredientId,
                  quantity: line.quantity,
                  unit: line.unit !== null && isUnitCode(line.unit) ? line.unit : null,
                  optional: line.isOptional,
                  label: line.rawText,
                })),
            },
          ]),
      );

      const { requirements, unresolved } = planRequirements(meals, recipeMap, ingredientMap);

      const balances = new Map<string, number>();
      for (const id of ingredientMap.keys()) {
        balances.set(
          id,
          balance(
            lots
              .filter((lot) => lot.ingredientId === id)
              .map((lot) => ({
                id: lot.id,
                ingredientId: lot.ingredientId,
                quantity: lot.quantity,
                acquiredAt: lot.acquiredAt,
                bestBefore: lot.bestBefore,
                reason: lot.reason,
              })),
          ),
        );
      }

      const shortfalls = diffAgainstPantry(requirements, balances).map((shortfall) => {
        const item = ingredientMap.get(shortfall.ingredientId);
        return {
          ingredient: item?.name ?? shortfall.ingredientId,
          required: shortfall.required,
          available: shortfall.available,
          missing: shortfall.shortfall,
          unit: item?.stockUnit ?? null,
        };
      });

      return text({
        week,
        items: shortfalls,
        unresolved: unresolved.map((line) => ({ recipe_id: line.recipeId, detail: line.detail })),
      });
    },
  );

  server.registerTool(
    "list_ingredients",
    {
      title: "List ingredients",
      description:
        "Search the ingredient catalogue by name or alias. Use this before saving a recipe so every line resolves to a real id and stock unit.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ query, limit }) => {
      const rows = await getDb()
        .select({
          id: ingredients.id,
          name: ingredients.name,
          stockUnit: ingredients.stockUnit,
          category: ingredients.category,
          aliases: ingredients.aliases,
        })
        .from(ingredients)
        .where(eq(ingredients.userId, userId));

      const needle = query?.trim().toLowerCase();
      const filtered = rows.filter(
        (row) =>
          needle === undefined ||
          needle === "" ||
          row.name.toLowerCase().includes(needle) ||
          (row.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle)),
      );

      return text(
        filtered.slice(0, limit ?? 50).map((row) => ({
          id: row.id,
          name: row.name,
          stock_unit: row.stockUnit,
          category: row.category,
          aliases: row.aliases,
        })),
      );
    },
  );

  server.registerTool(
    "create_ingredient",
    {
      title: "Create an ingredient",
      description:
        "Add one ingredient to the catalogue. Idempotent by name. Choose the unit you would actually count it in at home, and give grams per unit when the recipe measures it differently.",
      inputSchema: {
        name: z.string().min(1).max(80),
        stock_unit: z.string().min(1).max(16),
        category: z.enum(CATEGORIES).optional(),
        grams_per_unit: z
          .number()
          .positive()
          .max(100_000)
          .optional()
          .describe("Grams per one counted unit, e.g. 150 for an onion or 3 for a garlic clove"),
      },
    },
    async ({ name, stock_unit, category, grams_per_unit }) => {
      let unit: UnitCode;
      try {
        unit = assertUnitCode(stock_unit);
      } catch {
        return text({ error: `Unknown unit: ${stock_unit}` });
      }

      const slug = slugify(name);
      if (slug === "") return text({ error: "That name has no letters or numbers." });

      const db = getDb();
      const [existing] = await db
        .select()
        .from(ingredients)
        .where(and(eq(ingredients.userId, userId), eq(ingredients.slug, slug)))
        .limit(1);
      if (existing) {
        return text({
          id: existing.id,
          name: existing.name,
          stock_unit: existing.stockUnit,
          category: existing.category,
          existed: true,
        });
      }

      const chosen = category ?? "other";
      const [created] = await db
        .insert(ingredients)
        .values({
          userId,
          name: name.trim(),
          slug,
          category: chosen,
          stockUnit: unit,
          gramsPer: grams_per_unit !== undefined ? { each: grams_per_unit } : null,
          shelfLifeDays:
            chosen === "frozen" ? 180 : chosen === "dry" || chosen === "tins" ? 730 : 7,
        })
        .returning();

      if (!created) return text({ error: "Could not create that ingredient." });

      return text({
        id: created.id,
        name: created.name,
        stock_unit: created.stockUnit,
        category: created.category,
        existed: false,
      });
    },
  );

  const recipeLineInput = z.object({
    ingredient_id: z.uuid().optional(),
    name: z.string().min(1).max(120).optional(),
    quantity: z.number().positive().max(1_000_000),
    unit: z.string().min(1).max(16),
    note: z.string().max(200).optional(),
    optional: z.boolean().optional(),
  });

  server.registerTool(
    "create_recipe",
    {
      title: "Save a recipe",
      description:
        "Save a recipe the human has approved. Every line must resolve to a catalogue ingredient; unresolved names come back so you can ask or create them. Units must convert to the ingredient's stock unit.",
      inputSchema: {
        title: z.string().min(1).max(120),
        servings: z.number().int().min(1).max(24),
        source_url: z.url().optional().describe("Where you found it"),
        steps: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe("Markdown steps"),
        ingredients: z.array(recipeLineInput).min(1).max(60),
      },
    },
    async ({ title, servings, source_url, steps, ingredients: lines }) => {
      const db = getDb();
      const catalogue = await db.select().from(ingredients).where(eq(ingredients.userId, userId));

      const byId = new Map(catalogue.map((item) => [item.id, item]));
      const byName = new Map<string, (typeof catalogue)[number]>();
      for (const item of catalogue) {
        byName.set(item.name.toLowerCase(), item);
        for (const alias of item.aliases ?? []) byName.set(alias.toLowerCase(), item);
      }

      const unresolved: string[] = [];
      const conversionErrors: string[] = [];
      const resolved: {
        item: (typeof catalogue)[number];
        quantity: number;
        unit: string;
        note?: string;
        optional?: boolean;
      }[] = [];

      for (const line of lines) {
        const item = line.ingredient_id
          ? byId.get(line.ingredient_id)
          : line.name
            ? (byName.get(line.name.toLowerCase()) ??
              catalogue.find((candidate) => candidate.slug === slugify(line.name ?? "")))
            : undefined;

        if (!item) {
          unresolved.push(line.name ?? line.ingredient_id ?? "unknown");
          continue;
        }

        try {
          toBase(line.quantity, assertUnitCode(line.unit), {
            id: item.id,
            name: item.name,
            stockUnit: item.stockUnit as UnitCode,
            gramsPer: item.gramsPer ?? undefined,
          });
        } catch {
          conversionErrors.push(`${item.name}: ${line.unit} does not convert to ${item.stockUnit}`);
          continue;
        }

        resolved.push({
          item,
          quantity: line.quantity,
          unit: line.unit,
          note: line.note,
          optional: line.optional,
        });
      }

      if (unresolved.length > 0 || conversionErrors.length > 0) {
        return text({
          error: "Nothing was saved. Fix these lines and call again.",
          unresolved,
          conversion_errors: conversionErrors,
          hint: "Use list_ingredients to find ids, create_ingredient for new items, or ask the human how they measure it.",
        });
      }

      const stepList =
        typeof steps === "string"
          ? steps
              .split("\n")
              .map((step) => step.trim())
              .filter((step) => step.length > 0)
          : (steps ?? []).map((step) => step.trim()).filter((step) => step.length > 0);

      const recipeId = await db.transaction(async (tx) => {
        const [recipe] = await tx
          .insert(recipes)
          .values({
            userId,
            title: title.trim(),
            servings,
            sourceUrl: source_url ?? null,
            steps: stepList.map((step) => ({ text: step })),
            createdBy: "agent",
          })
          .returning({ id: recipes.id });
        if (!recipe) throw new Error("Could not save the recipe");

        await tx.insert(recipeIngredients).values(
          resolved.map((line, index) => ({
            recipeId: recipe.id,
            ingredientId: line.item.id,
            rawText: `${line.quantity} ${line.unit} ${line.item.name}${line.note ? ` (${line.note})` : ""}`,
            quantity: line.quantity,
            unit: line.unit,
            note: line.note ?? null,
            isOptional: line.optional ?? false,
            sortOrder: index,
            parseStatus: "ok",
          })),
        );

        return recipe.id;
      });

      revalidatePath("/recipes");

      return text({
        recipe_id: recipeId,
        title,
        lines: resolved.length,
        source_url: source_url ?? null,
        next: "Add it to a draft with create_meal_plan, then ask the human to activate it.",
      });
    },
  );

  server.registerTool(
    "create_meal_plan",
    {
      title: "Create a draft meal plan",
      description:
        "Propose meals for a week. Saved as a DRAFT: it does not affect shopping or cooking until the human activates it. Overwrites the slots it targets, leaves the rest alone.",
      inputSchema: {
        week_start: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Monday of the week"),
        note: z.string().max(500).optional().describe("Why this plan, in one or two sentences"),
        entries: z
          .array(
            z.object({
              day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              slot: z.enum(["lunch", "dinner"]),
              kind: z.enum(["recipe", "leftover"]).default("recipe"),
              recipe_id: z.uuid().optional(),
              portions: z.number().min(0.5).max(24),
            }),
          )
          .min(1)
          .max(21),
      },
    },
    async ({ week_start, note, entries }) => {
      const db = getDb();

      const outside = entries.filter((entry) => {
        const offset = daysBetween(week_start, entry.day);
        return offset < 0 || offset > 6;
      });
      if (outside.length > 0) return text({ error: "Every day must fall inside that week." });

      const missingRecipe = entries.filter(
        (entry) =>
          (entry.kind === "recipe" || entry.kind === "leftover") && entry.recipe_id === undefined,
      );
      if (missingRecipe.length > 0) {
        return text({ error: "Every entry needs a recipe_id." });
      }

      const recipeIds = [
        ...new Set(entries.flatMap((entry) => (entry.recipe_id ? [entry.recipe_id] : []))),
      ];
      const owned = await db
        .select({ id: recipes.id })
        .from(recipes)
        .where(eq(recipes.userId, userId));
      const ownedIds = new Set(owned.map((recipe) => recipe.id));
      const foreign = recipeIds.filter((id) => !ownedIds.has(id));
      if (foreign.length > 0) return text({ error: "One or more recipes aren't in the library." });

      const planId = await ensurePlan(userId, week_start);

      await db.transaction(async (tx) => {
        await tx
          .update(mealPlans)
          .set({ status: "draft", createdBy: "agent", notes: note ?? null })
          .where(eq(mealPlans.id, planId));

        for (const entry of entries) {
          await tx
            .insert(mealPlanEntries)
            .values({
              planId,
              day: entry.day,
              slot: entry.slot,
              kind: entry.kind,
              recipeId: entry.recipe_id ?? null,
              leftoverId: null,
              portions: entry.portions,
              status: "planned",
              createdBy: "agent",
            })
            .onConflictDoUpdate({
              target: [mealPlanEntries.planId, mealPlanEntries.day, mealPlanEntries.slot],
              set: {
                kind: entry.kind,
                recipeId: entry.recipe_id ?? null,
                leftoverId: null,
                portions: entry.portions,
                status: "planned",
                createdBy: "agent",
                cookEventId: null,
              },
            });
        }
      });

      revalidatePath("/plan");
      revalidatePath(`/plan/${week_start}`);

      return text({
        week: week_start,
        status: "draft",
        entries_written: entries.length,
        next: "Ask the human to open the Plan tab and activate or discard the draft.",
      });
    },
  );

  return server;
}
