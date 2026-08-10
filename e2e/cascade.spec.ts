import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

type MealTime = "breakfast" | "lunch";

type Fixture = {
  userId: string;
  ingredientId: string;
  ingredientName: string;
  recipeId: string;
  recipeName: string;
  shopId: string;
  shopName: string;
  otherShopId: string;
  otherShopName: string;
  aisleName: string;
  agentToken: string;
  slotDate: string;
  mealTime: MealTime;
};

type McpResponse = {
  result?: { structuredContent?: Record<string, unknown> };
  error?: { message?: string };
};

type InboxMessage = { id?: string; ID?: string };

const INBOX_URL = process.env.E2E_INBOX_URL ?? "http://127.0.0.1:54324";
const PURCHASED_AMOUNT = 250;
const REQUIRED_AMOUNT = 100;
const EDITED_MULTIPLIER = 2;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for cascade e2e fixtures`);
  return value;
}

function fixtureDetails(testInfo: TestInfo) {
  const isMobile = testInfo.project.name.includes("mobile");
  return {
    mealTime: (isMobile ? "lunch" : "breakfast") as MealTime,
    shopPosition: isMobile ? 9_002 : 9_000,
  };
}

function tokenSecret(): string {
  return `agt_${randomBytes(32).toString("base64url")}`;
}

function tokenHash(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function messageId(message: InboxMessage): string | null {
  const id = message.id ?? message.ID;
  return typeof id === "string" && id !== "" ? id : null;
}

function magicLink(value: unknown): string | null {
  const text = JSON.stringify(value).replace(/=\r?\n/g, "").replace(/=3D/g, "=");
  const match = text.match(/https?:\/\/[^"'\\\s<>]*\/auth\/v1\/verify[^"'\\\s<>]*/)?.[0];
  return match?.replaceAll("&amp;", "&") ?? null;
}

async function waitForMagicLink(request: APIRequestContext, email: string): Promise<string> {
  const mailbox = email.split("@", 1)[0];
  let found: string | null = null;

  await expect.poll(async () => {
    const summaries = await request.get(`${INBOX_URL}/api/v1/mailbox/${encodeURIComponent(mailbox)}`);
    if (!summaries.ok()) return null;
    const payload = (await summaries.json()) as InboxMessage[] | { messages?: InboxMessage[] };
    const messages = Array.isArray(payload) ? payload : payload.messages ?? [];
    const id = messages.map(messageId).find((value): value is string => value !== null);
    if (!id) return null;

    const detail = await request.get(`${INBOX_URL}/api/v1/message/${encodeURIComponent(id)}`);
    if (!detail.ok()) return null;
    found = magicLink(await detail.json());
    return found;
  }, { message: `magic link for ${email} did not arrive` }).toBeTruthy();

  if (!found) throw new Error(`No magic link found for ${email}`);
  return found;
}

async function signInWithMagicLink(page: Page, request: APIRequestContext, email: string) {
  await page.goto("/login");
  await page.getByLabel(/email address/i).fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByTestId("login-sent-message")).toBeVisible();

  await page.goto(await waitForMagicLink(request, email));
  await expect(page).toHaveURL(/\/plan$/);
}

async function seedFixture(database: Client, email: string, testInfo: TestInfo): Promise<Fixture> {
  const userResult = await database.query<{ id: string }>("select id from auth.users where email = $1", [email]);
  const userId = userResult.rows[0]?.id;
  if (!userId) throw new Error(`Signed-in user ${email} was not created`);

  const suffix = randomUUID().slice(0, 8);
  const { mealTime, shopPosition } = fixtureDetails(testInfo);
  const ingredientId = randomUUID();
  const recipeId = randomUUID();
  const shopId = randomUUID();
  const otherShopId = randomUUID();
  const aisleId = randomUUID();
  const agentToken = tokenSecret();
  const ingredientName = `Cascade lentils ${suffix}`;
  const recipeName = `Cascade soup ${suffix}`;
  const shopName = `Cascade Market ${suffix}`;
  const otherShopName = `Cascade Other Shop ${suffix}`;
  const aisleName = `Cascade Dry Goods ${suffix}`;
  const calendar = await database.query<{ today: string }>("select current_date::text as today");
  const slotDate = calendar.rows[0]?.today;
  if (!slotDate) throw new Error("Database did not return current_date");

  await database.query(
    "insert into public.ingredients (id, name, stock_unit, last_purchased_amount) values ($1, $2, 'g', $3)",
    [ingredientId, ingredientName, PURCHASED_AMOUNT]
  );
  await database.query(
    "insert into public.recipes (id, name, servings, max_multiplier, status) values ($1, $2, 1, $3, 'confirmed')",
    [recipeId, recipeName, EDITED_MULTIPLIER]
  );
  await database.query(
    "insert into public.recipe_lines (recipe_id, ingredient_id, amount, unit, position) values ($1, $2, $3, 'g', 0)",
    [recipeId, ingredientId, REQUIRED_AMOUNT]
  );
  await database.query("insert into public.shops (id, name, position) values ($1, $2, $3), ($4, $5, $6)", [
    shopId,
    shopName,
    shopPosition,
    otherShopId,
    otherShopName,
    shopPosition + 1,
  ]);
  await database.query(
    "insert into public.aisles (id, shop_id, name, emoji, position) values ($1, $2, $3, '🥫', 0)",
    [aisleId, shopId, aisleName]
  );
  await database.query("insert into public.placements (ingredient_id, aisle_id) values ($1, $2)", [ingredientId, aisleId]);
  await database.query(
    "insert into public.agent_tokens (user_id, token_hash, label) values ($1, $2, 'cascade e2e runner')",
    [userId, tokenHash(agentToken)]
  );

  return {
    userId,
    ingredientId,
    ingredientName,
    recipeId,
    recipeName,
    shopId,
    shopName,
    otherShopId,
    otherShopName,
    aisleName,
    agentToken,
    slotDate,
    mealTime,
  };
}

async function cleanupFixture(database: Client, fixture: Fixture) {
  await database.query(
    "delete from public.meal_plan_slots where recipe_id = $1 or confirmed_plan_proposal_id in (select id from public.plan_proposals where user_id = $2)",
    [fixture.recipeId, fixture.userId]
  );
  await database.query("delete from public.meal_logs where recipe_id = $1", [fixture.recipeId]);
  await database.query("delete from public.cooks where recipe_id = $1", [fixture.recipeId]);
  await database.query("delete from public.portion_batches where recipe_id = $1", [fixture.recipeId]);
  await database.query("delete from public.shopping_items where ingredient_id = $1", [fixture.ingredientId]);
  await database.query("delete from public.recipe_lines where recipe_id = $1", [fixture.recipeId]);
  await database.query("delete from public.recipes where id = $1", [fixture.recipeId]);
  await database.query("delete from public.stock_lots where ingredient_id = $1", [fixture.ingredientId]);
  await database.query("delete from public.shops where id in ($1, $2)", [fixture.shopId, fixture.otherShopId]);
  await database.query("delete from public.ingredients where id = $1", [fixture.ingredientId]);
  await database.query("delete from public.plan_proposals where user_id = $1", [fixture.userId]);
  await database.query("delete from auth.users where id = $1", [fixture.userId]);
}

async function callMcp(
  request: APIRequestContext,
  agentToken: string,
  name: string,
  argumentsValue: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await request.post("/api/mcp", {
    headers: { authorization: `Bearer ${agentToken}` },
    data: {
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: { name, arguments: argumentsValue },
    },
  });
  if (!response.ok()) {
    throw new Error(`MCP ${name} failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as McpResponse;
  if (body.error) throw new Error(body.error.message ?? "MCP returned an error");
  if (!body.result?.structuredContent) throw new Error("MCP response omitted structured content");
  return body.result.structuredContent;
}

async function submitProposal(request: APIRequestContext, fixture: Fixture): Promise<string> {
  const result = await callMcp(request, fixture.agentToken, "larder_submit_plan_proposal", {
    planningHorizon: fixture.slotDate,
    slots: [{
      slotDate: fixture.slotDate,
      mealTime: fixture.mealTime,
      recipeId: fixture.recipeId,
      isCook: true,
      cookMultiplier: 1,
    }],
    newRecipes: [],
    newIngredients: [],
    suggestedAliases: [],
  });

  expect(result.accepted).toBe(true);
  const proposal = result.proposal as { id?: unknown } | undefined;
  if (typeof proposal?.id !== "string") throw new Error("Accepted proposal omitted its id");
  return proposal.id;
}

async function requiredAmount(database: Client, ingredientId: string): Promise<number | null> {
  const result = await database.query<{ required_amount: string }>(
    "select required_amount from public.shopping_items where ingredient_id = $1",
    [ingredientId]
  );
  return result.rows[0] ? Number(result.rows[0].required_amount) : null;
}

async function stockQuantity(database: Client, ingredientId: string): Promise<number | null> {
  const result = await database.query<{ quantity: string }>(
    "select quantity from public.stock_lots where ingredient_id = $1",
    [ingredientId]
  );
  return result.rows[0] ? Number(result.rows[0].quantity) : null;
}

async function portionsRemaining(database: Client, recipeId: string): Promise<number | null> {
  const result = await database.query<{ portions_remaining: number }>(
    "select portions_remaining from public.portion_batches where recipe_id = $1",
    [recipeId]
  );
  return result.rows[0]?.portions_remaining ?? null;
}

test.describe("proposal to meal log cascade", () => {
  test("confirms, shops, cooks, eats, and never rewrites Shopping", async ({ page, request }, testInfo) => {
    const email = `cascade-${testInfo.project.name.replace(/[^a-z0-9]/gi, "-")}-${randomUUID()}@e2e.test`;
    await signInWithMagicLink(page, request, email);

    const database = new Client({ connectionString: requiredEnvironment("DATABASE_URL") });
    await database.connect();
    let fixture: Fixture | undefined;

    try {
      fixture = await seedFixture(database, email, testInfo);
      const proposalId = await submitProposal(request, fixture);

      await page.goto("/plan/review");
      await expect(page.getByRole("heading", { name: "Plan Proposals" })).toBeVisible();
      await page.getByRole("button", { name: "Confirm plan" }).click();
      await expect(page.getByText("No Plan Proposals awaiting review.")).toBeVisible();
      expect(await requiredAmount(database, fixture.ingredientId)).toBe(REQUIRED_AMOUNT);

      await page.goto("/plan");
      const plannedSlot = page.getByRole("article").filter({ hasText: fixture.recipeName });
      await plannedSlot.getByRole("button", { name: "Edit" }).click();
      const editor = page.getByRole("form", { name: "Edit Meal Slot" });
      await editor.getByLabel("Cook multiplier").fill(String(EDITED_MULTIPLIER));
      await editor.getByRole("button", { name: "Save slot" }).click();
      await expect(editor).toHaveCount(0);
      expect(await requiredAmount(database, fixture.ingredientId)).toBe(REQUIRED_AMOUNT);

      await page.goto("/shopping");
      await page.getByRole("tab", { name: fixture.otherShopName }).click();
      await expect(page.getByTestId("shop-list-empty")).toBeVisible();
      await page.getByRole("tab", { name: fixture.shopName }).click();
      const aisle = page.getByRole("region", { name: fixture.aisleName });
      await expect(aisle).toContainText(fixture.ingredientName);
      await expect(aisle).toContainText(`Required: ${REQUIRED_AMOUNT} g`);
      await expect(aisle).toContainText(`Suggested: ${PURCHASED_AMOUNT} g`);
      await aisle.getByRole("button", { name: "Buy suggested amount" }).click();
      await expect(aisle.getByText(fixture.ingredientName)).toHaveCount(0);
      expect(await stockQuantity(database, fixture.ingredientId)).toBe(PURCHASED_AMOUNT);

      await page.goto("/pantry");
      const pantryIngredient = page.getByRole("button", { name: new RegExp(fixture.ingredientName) });
      await expect(pantryIngredient).toContainText(`${PURCHASED_AMOUNT} g`);
      await pantryIngredient.click();
      await expect(page.getByTestId("stock-lot-row")).toContainText(`${PURCHASED_AMOUNT} g`);

      await page.goto("/plan");
      const cookSlot = page.getByRole("article").filter({ hasText: fixture.recipeName });
      await cookSlot.getByRole("button", { name: `Preview cook ${fixture.recipeName}` }).click();
      await expect(cookSlot).toContainText(`Makes ${EDITED_MULTIPLIER} Portions`);
      await cookSlot.getByRole("button", { name: "Cook anyway" }).click();
      await expect(cookSlot.getByRole("button", { name: "Cook anyway" })).toHaveCount(0);
      expect(await stockQuantity(database, fixture.ingredientId)).toBe(PURCHASED_AMOUNT - REQUIRED_AMOUNT * EDITED_MULTIPLIER);
      expect(await portionsRemaining(database, fixture.recipeId)).toBe(EDITED_MULTIPLIER);

      await page.goto("/meals");
      const mealStock = page.getByRole("heading", { name: fixture.recipeName });
      await expect(mealStock).toBeVisible();
      await expect(mealStock.locator("..")).toContainText(`${EDITED_MULTIPLIER} Portions`);
      await page.getByRole("button", { name: `Eat ${fixture.recipeName}` }).click();
      await expect(mealStock.locator("..")).toContainText(`${EDITED_MULTIPLIER - 1} Portions`);
      expect(await portionsRemaining(database, fixture.recipeId)).toBe(EDITED_MULTIPLIER - 1);

      const mealLog = await callMcp(request, fixture.agentToken, "larder_read_meal_log", {});
      const entries = (mealLog.mealLogEntries as Array<Record<string, unknown>>).filter(
        (entry) => entry.recipeId === fixture!.recipeId
      );
      expect(entries).toEqual([
        expect.objectContaining({ kind: "eaten", recipeId: fixture.recipeId, recipeName: fixture.recipeName }),
      ]);

      const planState = await database.query<{ cook_id: string | null; shopping_items: number }>(
        `select s.cook_id,
                (select count(*)::int from public.shopping_items where ingredient_id = $2) as shopping_items
         from public.meal_plan_slots s
         where s.confirmed_plan_proposal_id = $1 and s.recipe_id = $3`,
        [proposalId, fixture.ingredientId, fixture.recipeId]
      );
      expect(planState.rows).toEqual([{ cook_id: expect.any(String), shopping_items: 0 }]);
    } finally {
      if (fixture) {
        await cleanupFixture(database, fixture);
      } else {
        await database.query("delete from auth.users where email = $1", [email]);
      }
      await database.end();
    }
  });
});
