import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The SQL layer, exercised against real Postgres compiled to WASM.
 *
 * The domain engine is tested without a database; this file is only here to
 * prove the things TypeScript can't: the migration applies, the balance view
 * sums correctly, and a failed write rolls back.
 */

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));

function migrationSql(): string {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n");
}

let db: PGlite;
let userId: string;
let riceId: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(migrationSql());

  const user = await db.query<{ id: string }>(
    "insert into users (name) values ('Test') returning id",
  );
  userId = user.rows[0]?.id ?? "";

  const category = await db.query<{ id: string }>(
    "insert into categories (user_id, name, slug, sort_order) values ($1, 'Dry goods', 'dry', 5) returning id",
    [userId],
  );
  const categoryId = category.rows[0]?.id ?? "";

  const ingredient = await db.query<{ id: string }>(
    `insert into ingredients (user_id, name, slug, category, stock_unit, shelf_life_days)
     values ($1, 'Rice', 'rice', $2, 'g', 730) returning id`,
    [userId, categoryId],
  );
  riceId = ingredient.rows[0]?.id ?? "";
});

afterAll(async () => {
  await db.close();
});

describe("migration", () => {
  it("creates every core table", async () => {
    const result = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    );
    const tables = result.rows.map((row) => row.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "audit_log",
        "cook_events",
        "ingredients",
        "leftovers",
        "meal_plan_entries",
        "meal_plans",
        "recipe_ingredients",
        "recipes",
        "shopping_items",
        "shopping_lists",
        "stock_entries",
        "ticktick_settings",
        "users",
      ]),
    );
  });
});

describe("pantry_balance", () => {
  it("sums the ledger instead of storing a total", async () => {
    await db.query(
      `insert into stock_entries (user_id, ingredient_id, quantity, reason, acquired_at)
       values ($1, $2, 500, 'purchase', '2026-11-01'),
              ($1, $2, 300, 'purchase', '2026-11-05'),
              ($1, $2, -200, 'cook', '2026-11-06')`,
      [userId, riceId],
    );

    const result = await db.query<{ quantity: string }>(
      "select quantity from pantry_balance where ingredient_id = $1",
      [riceId],
    );
    expect(Number(result.rows[0]?.quantity)).toBe(600);
  });

  it("has a row per ingredient, not per entry", async () => {
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from pantry_balance where ingredient_id = $1",
      [riceId],
    );
    expect(result.rows[0]?.count).toBe("1");
  });
});

describe("transactions", () => {
  it("rolls back a failed multi-row write", async () => {
    await expect(
      db.exec(`
        begin;
        insert into stock_entries (user_id, ingredient_id, quantity, reason, acquired_at)
        values ('${userId}', '${riceId}', 999, 'adjust', '2026-11-10');
        select 1 / 0;
        commit;
      `),
    ).rejects.toThrow();

    await db.exec("rollback");

    const result = await db.query<{ quantity: number }>(
      "select sum(quantity)::float8 as quantity from stock_entries where ingredient_id = $1",
      [riceId],
    );
    expect(result.rows[0]?.quantity).toBe(600);
  });
});

describe("constraints", () => {
  it("allows more than one dish in the same meal-plan slot", async () => {
    const plan = await db.query<{ id: string }>(
      `insert into meal_plans (user_id, week_start) values ($1, '2026-11-09') returning id`,
      [userId],
    );
    const planId = plan.rows[0]?.id ?? "";

    const insert = (title: string) =>
      db.query<{ id: string }>(
        `insert into recipes (user_id, title) values ($1, $2) returning id`,
        [userId, title],
      );

    const first = await insert("Soup");
    const second = await insert("Stew");

    await db.query(
      `insert into meal_plan_entries (plan_id, day, slot, recipe_id)
       values ($1, '2026-11-10', 'dinner', $2)`,
      [planId, first.rows[0]?.id],
    );

    await expect(
      db.query(
        `insert into meal_plan_entries (plan_id, day, slot, recipe_id)
         values ($1, '2026-11-10', 'dinner', $2)`,
        [planId, second.rows[0]?.id],
      ),
    ).resolves.toBeDefined();

    const count = await db.query<{ count: string }>(
      `select count(*)::text as count from meal_plan_entries
       where plan_id = $1 and day = '2026-11-10' and slot = 'dinner'`,
      [planId],
    );
    expect(count.rows[0]?.count).toBe("2");
  });

  it("stores AI notes on a recipe", async () => {
    const recipe = await db.query<{ id: string }>(
      `insert into recipes (user_id, title, ai_notes) values ($1, 'Wings', 'Serve with a salad') returning id`,
      [userId],
    );
    const result = await db.query<{ ai_notes: string }>(
      "select ai_notes from recipes where id = $1",
      [recipe.rows[0]?.id],
    );
    expect(result.rows[0]?.ai_notes).toBe("Serve with a salad");
  });

  it("allows a negative entry, because consumption is recorded that way", async () => {
    await expect(
      db.query(
        `insert into stock_entries (user_id, ingredient_id, quantity, reason, acquired_at)
         values ($1, $2, -10, 'cook', '2026-11-10')`,
        [userId, riceId],
      ),
    ).resolves.toBeDefined();
    // The domain layer is what guarantees a deduction never exceeds what the
    // ledger holds. The database records facts, including a correction.
  });
});
