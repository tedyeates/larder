import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";

vi.mock("server-only", () => ({}));

import { POST } from "./route";
import { hashAgentToken } from "@/lib/agent-gateway/tokens";

type RpcBody = {
  jsonrpc: string;
  id: string | number | null;
  error?: { code: number; message: string };
  result?: { tools?: { name: string }[]; structuredContent?: Record<string, unknown> };
};

const userId = randomUUID();
const ingredientId = randomUUID();
const recipeId = randomUUID();
const recipeLineId = randomUUID();
const stockLotId = randomUUID();
const portionBatchId = randomUUID();
const mealLogId = randomUUID();
const preferenceId = randomUUID();
const mealSlotId = randomUUID();
const shoppingItemId = randomUUID();
const tokenId = randomUUID();
const revokedTokenId = randomUUID();
const immediatelyRevokedTokenId = randomUUID();
const fixtureName = `Agent Gateway ${randomUUID()}`;
const validToken = `agt_${randomBytes(32).toString("base64url")}`;
const revokedToken = `agt_${randomBytes(32).toString("base64url")}`;
const immediatelyRevokedToken = `agt_${randomBytes(32).toString("base64url")}`;

let database: Pool;

function request(body: Record<string, unknown>, token?: string) {
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    })
  );
}

async function rpc(response: Response): Promise<RpcBody> {
  return (await response.json()) as RpcBody;
}

async function callTool(name: string, argumentsValue: Record<string, unknown> = {}) {
  return request({ method: "tools/call", params: { name, arguments: argumentsValue } }, validToken);
}

function structured(body: RpcBody): Record<string, unknown> {
  expect(body.result?.structuredContent).toBeDefined();
  return body.result!.structuredContent!;
}

describe("POST /api/mcp", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Agent Gateway integration tests");
    database = new Pool({ connectionString: process.env.DATABASE_URL });

    await database.query(`insert into auth.users (id, email) values ($1, $2)`, [
      userId,
      `${userId}@agent-gateway.test`,
    ]);
    await database.query(
      `insert into public.agent_tokens (id, user_id, token_hash, label, revoked_at)
       values ($1, $2, $3, 'test runner', null),
              ($4, $2, $5, 'revoked runner', now()),
              ($6, $2, $7, 'immediately revoked runner', null)`,
      [
        tokenId,
        userId,
        hashAgentToken(validToken),
        revokedTokenId,
        hashAgentToken(revokedToken),
        immediatelyRevokedTokenId,
        hashAgentToken(immediatelyRevokedToken),
      ]
    );
    await database.query(
      `insert into public.ingredients (id, name, stock_unit, is_hand_depleted)
       values ($1, $2, 'g', false)`,
      [ingredientId, `${fixtureName} Ingredient`]
    );
    await database.query(
      `insert into public.recipes (id, name, servings, max_multiplier, steps)
       values ($1, $2, 2, 3, 'Cook and serve')`,
      [recipeId, `${fixtureName} Recipe`]
    );
    await database.query(
      `insert into public.recipe_lines (id, recipe_id, ingredient_id, amount, unit, position)
       values ($1, $2, $3, 200, 'g', 0)`,
      [recipeLineId, recipeId, ingredientId]
    );
    await database.query(
      `insert into public.stock_lots (id, ingredient_id, quantity, storage_location, acquired_on)
       values ($1, $2, 500, 'cupboard', '2099-01-01')`,
      [stockLotId, ingredientId]
    );
    await database.query(
      `insert into public.portion_batches (id, recipe_id, portions_remaining, storage_location, cooked_on)
       values ($1, $2, 2, 'fridge', '2099-01-01')`,
      [portionBatchId, recipeId]
    );
    await database.query(
      `insert into public.meal_logs (id, occurred_on, meal_time, kind, recipe_id, recipe_name, note)
       values ($1, '2099-01-01', 'dinner', 'eaten', $2, $3, 'fixture meal')`,
      [mealLogId, recipeId, `${fixtureName} Recipe`]
    );
    await database.query(
      `insert into public.preferences (id, category, body)
       values ($1, 'variety', $2)`,
      [preferenceId, `${fixtureName} preference`]
    );
    await database.query(
      `insert into public.meal_plan_slots
         (id, slot_date, meal_time, recipe_id, is_cook, cook_multiplier)
       values ($1, '2099-01-02', 'dinner', $2, false, 1)`,
      [mealSlotId, recipeId]
    );
    await database.query(
      `insert into public.shopping_items (id, ingredient_id, required_amount)
       values ($1, $2, 100)`,
      [shoppingItemId, ingredientId]
    );
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from public.shopping_items where id = $1", [shoppingItemId]);
    await database.query("delete from public.meal_plan_slots where id = $1", [mealSlotId]);
    await database.query("delete from public.meal_logs where id = $1", [mealLogId]);
    await database.query("delete from public.portion_batches where id = $1", [portionBatchId]);
    await database.query("delete from public.stock_lots where id = $1", [stockLotId]);
    await database.query("delete from public.recipe_lines where id = $1", [recipeLineId]);
    await database.query("delete from public.recipes where id = $1", [recipeId]);
    await database.query("delete from public.ingredients where id = $1", [ingredientId]);
    await database.query("delete from public.preferences where id = $1", [preferenceId]);
    await database.query("delete from public.agent_tokens where id in ($1, $2, $3)", [
      tokenId,
      revokedTokenId,
      immediatelyRevokedTokenId,
    ]);
    await database.query("delete from auth.users where id = $1", [userId]);
    await database.end();
  });

  // Authentication failures come first: no user data or tool catalogue is
  // observable until an Agent Token resolves to an active owner.
  it("rejects a tool request without an Agent Token", async () => {
    const response = await request({ method: "tools/list" });
    expect(response.status).toBe(401);
    await expect(rpc(response)).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32001, message: "Missing Agent Token" },
    });
  });

  it("rejects a malformed Agent Token", async () => {
    const response = await request({ method: "tools/list" }, "not-an-agent-token");
    expect(response.status).toBe(401);
    await expect(rpc(response)).resolves.toMatchObject({
      error: { code: -32001, message: "Malformed Agent Token" },
    });
  });

  it("rejects a revoked Agent Token immediately", async () => {
    const response = await request({ method: "tools/list" }, revokedToken);
    expect(response.status).toBe(401);
    await expect(rpc(response)).resolves.toMatchObject({
      error: { code: -32001, message: "Invalid or revoked Agent Token" },
    });
  });

  it("rejects a formerly active Agent Token on its next request after revocation", async () => {
    const activeResponse = await request({ method: "tools/list" }, immediatelyRevokedToken);
    expect(activeResponse.status).toBe(200);

    await database.query("update public.agent_tokens set revoked_at = now() where id = $1", [
      immediatelyRevokedTokenId,
    ]);

    const revokedResponse = await request({ method: "tools/list" }, immediatelyRevokedToken);
    expect(revokedResponse.status).toBe(401);
    await expect(rpc(revokedResponse)).resolves.toMatchObject({
      error: { code: -32001, message: "Invalid or revoked Agent Token" },
    });
  });

  it("lists documented MCP tools after resolving a valid token owner", async () => {
    const response = await request({ method: "tools/list" }, validToken);
    expect(response.status).toBe(200);
    const body = await rpc(response);
    expect(body.result?.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "larder_list_recipes",
        "larder_read_pantry",
        "larder_read_meal_stock",
        "larder_read_meal_log",
        "larder_list_preferences",
        "larder_read_current_meal_slots",
      ])
    );
  });

  it("reads Recipes with their ordered Lines", async () => {
    const response = await callTool("larder_list_recipes");
    expect(response.status).toBe(200);
    expect(structured(await rpc(response))).toMatchObject({
      recipes: [
        expect.objectContaining({
          id: recipeId,
          name: `${fixtureName} Recipe`,
          lines: [expect.objectContaining({ id: recipeLineId, ingredientId, amount: 200, unit: "g" })],
        }),
      ],
    });
  });

  it("reads Pantry summaries without exposing Stock Lots", async () => {
    const response = await callTool("larder_read_pantry");
    expect(response.status).toBe(200);
    const content = structured(await rpc(response));
    expect(content).toMatchObject({
      pantry: [expect.objectContaining({ ingredientId, totalQuantity: 500, storageLocation: "cupboard" })],
    });
    expect(JSON.stringify(content)).not.toContain(stockLotId);
  });

  it("reads Meal Stock summaries without exposing Portion Batches", async () => {
    const response = await callTool("larder_read_meal_stock");
    expect(response.status).toBe(200);
    const content = structured(await rpc(response));
    expect(content).toMatchObject({ mealStock: [expect.objectContaining({ recipeId, totalPortions: 2 })] });
    expect(JSON.stringify(content)).not.toContain(portionBatchId);
  });

  it("reads Meal Log entries with date-only occurrence dates", async () => {
    const response = await callTool("larder_read_meal_log");
    expect(response.status).toBe(200);
    expect(structured(await rpc(response))).toMatchObject({
      mealLogEntries: [
        expect.objectContaining({
          id: mealLogId,
          kind: "eaten",
          recipeId,
          occurredOn: "2099-01-01",
        }),
      ],
    });
  });

  it("reads Preferences", async () => {
    const response = await callTool("larder_list_preferences");
    expect(response.status).toBe(200);
    expect(structured(await rpc(response))).toMatchObject({
      preferences: [expect.objectContaining({ id: preferenceId, body: `${fixtureName} preference` })],
    });
  });

  it("reads current Meal Slots", async () => {
    const response = await callTool("larder_read_current_meal_slots");
    expect(response.status).toBe(200);
    expect(structured(await rpc(response))).toMatchObject({
      mealSlots: [expect.objectContaining({ id: mealSlotId, slotDate: "2099-01-02", recipeId })],
    });
  });

  it("allows Preference writes and no other write category", async () => {
    const createdResponse = await callTool("larder_create_preference", {
      body: `${fixtureName} created preference`,
      category: "diet",
    });
    expect(createdResponse.status).toBe(200);
    const created = structured(await rpc(createdResponse)).preference as { id: string; body: string };
    expect(created.body).toBe(`${fixtureName} created preference`);

    const updatedResponse = await callTool("larder_update_preference", {
      id: created.id,
      body: `${fixtureName} updated preference`,
    });
    expect(updatedResponse.status).toBe(200);
    expect(structured(await rpc(updatedResponse))).toMatchObject({
      preference: { id: created.id, body: `${fixtureName} updated preference` },
    });

    const deletedResponse = await callTool("larder_delete_preference", { id: created.id });
    expect(deletedResponse.status).toBe(200);
    expect(structured(await rpc(deletedResponse))).toEqual({ deletedPreferenceId: created.id });
  });

  it("refuses writes to Stock Lots, Portion Batches, Meal Log, and Shopping Items", async () => {
    const before = await database.query<{ stock_lots: string; portion_batches: string; meal_logs: string; shopping_items: string }>(
      `select
         (select count(*) from public.stock_lots where id = $1) as stock_lots,
         (select count(*) from public.portion_batches where id = $2) as portion_batches,
         (select count(*) from public.meal_logs where id = $3) as meal_logs,
         (select count(*) from public.shopping_items where id = $4) as shopping_items`,
      [stockLotId, portionBatchId, mealLogId, shoppingItemId]
    );

    for (const name of [
      "larder_create_stock_lot",
      "larder_create_portion_batch",
      "larder_create_meal_log_entry",
      "larder_create_shopping_item",
    ]) {
      const response = await callTool(name, {});
      expect(response.status).toBe(403);
      await expect(rpc(response)).resolves.toMatchObject({
        error: { code: -32003, message: "Unknown or forbidden MCP tool" },
      });
    }

    const after = await database.query(
      `select
         (select count(*) from public.stock_lots where id = $1) as stock_lots,
         (select count(*) from public.portion_batches where id = $2) as portion_batches,
         (select count(*) from public.meal_logs where id = $3) as meal_logs,
         (select count(*) from public.shopping_items where id = $4) as shopping_items`,
      [stockLotId, portionBatchId, mealLogId, shoppingItemId]
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
