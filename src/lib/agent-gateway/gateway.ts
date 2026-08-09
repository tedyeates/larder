import "server-only";

import { Pool, type PoolClient } from "pg";
import { hashAgentToken, isAgentTokenSecret } from "./tokens";

export class AgentTokenAuthenticationError extends Error {
  constructor() {
    super("Invalid or revoked Agent Token");
  }
}

export class McpToolError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type JsonObject = Record<string, unknown>;
type ToolResult = Record<string, unknown>;

export const AGENT_GATEWAY_TOOLS = [
  {
    name: "larder_list_recipes",
    description: "List Recipes with their Tags and ordered Lines.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "larder_read_pantry",
    description: "Read Pantry totals by Ingredient and Storage Location, never individual Stock Lots.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "larder_read_meal_stock",
    description: "Read Meal Stock totals by Recipe or labelled ready meal, never Portion Batches.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "larder_read_meal_log",
    description: "Read Meal Log entries: record of what was actually eaten.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "larder_list_preferences",
    description: "List Preferences the planner should reason with.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "larder_read_current_meal_slots",
    description: "Read today and future Meal Slots, including Cookable and Shortfall state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "larder_create_preference",
    description: "Create one Preference. This is the only write scope in this gateway version.",
    inputSchema: {
      type: "object",
      required: ["body"],
      properties: { body: { type: "string" }, category: { type: ["string", "null"] } },
      additionalProperties: false,
    },
  },
  {
    name: "larder_update_preference",
    description: "Update one Preference. This is the only write scope in this gateway version.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        body: { type: "string" },
        category: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "larder_delete_preference",
    description: "Delete one Preference. This is the only write scope in this gateway version.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false,
    },
  },
] as const;

type AgentGatewayToolName = (typeof AGENT_GATEWAY_TOOLS)[number]["name"];

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Agent Gateway requires DATABASE_URL on the app server");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

function asObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new McpToolError(400, "Tool arguments must be an object");
  }
  return value as JsonObject;
}

function optionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new McpToolError(400, `${field} must be a string or null`);
  return value;
}

function requiredNonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new McpToolError(400, `${field} must be a non-blank string`);
  }
  return value.trim();
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function records(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(asRecord) : [];
}

function asRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function withAgentToken<T>(secret: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!isAgentTokenSecret(secret)) {
    throw new AgentTokenAuthenticationError();
  }

  const client = await getPool().connect();
  let transactionOpen = false;
  try {
    await client.query("begin");
    transactionOpen = true;

    // This narrow lookup is intentionally the only action performed before
    // switching to the owning user. It returns no token material and rejects
    // revoked rows in the same query, so revocation takes effect immediately.
    const token = await client.query<{ user_id: string }>(
      `select user_id
       from public.agent_tokens
       where token_hash = $1 and revoked_at is null`,
      [hashAgentToken(secret)]
    );
    const ownerId = token.rows[0]?.user_id;
    if (!ownerId) throw new AgentTokenAuthenticationError();

    // The app server owns DATABASE_URL; the Agent Runner never sees it. All
    // tool queries below run as `authenticated` with this token owner's JWT
    // claims, so the normal RLS policies remain the data access boundary.
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ownerId, role: "authenticated" }),
    ]);

    const result = await work(client);
    await client.query("commit");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function toPreference(row: JsonObject) {
  return {
    id: String(row.id),
    category: row.category === null ? null : String(row.category),
    body: String(row.body),
    updatedAt: timestamp(row.updated_at),
  };
}

async function readRecipes(client: PoolClient): Promise<ToolResult> {
  const result = await client.query(
    `select
       r.id, r.name, r.servings, r.max_multiplier, r.rating,
       r.prep_minutes, r.cook_minutes, r.source, r.steps,
       coalesce((
         select jsonb_agg(tag order by tag)
         from public.recipe_tags where recipe_id = r.id
       ), '[]'::jsonb) as tags,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', l.id,
           'ingredientId', l.ingredient_id,
           'ingredientName', i.name,
           'rawName', l.raw_name,
           'amount', l.amount,
           'unit', l.unit,
           'note', l.note,
           'isEssential', l.is_essential,
           'position', l.position
         ) order by l.position)
         from public.recipe_lines l
         left join public.ingredients i on i.id = l.ingredient_id
         where l.recipe_id = r.id
       ), '[]'::jsonb) as lines
     from public.recipes r
     order by r.name asc, r.id asc`
  );

  return {
    recipes: result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      servings: Number(row.servings),
      maxMultiplier: Number(row.max_multiplier),
      rating: row.rating === null ? null : Number(row.rating),
      prepMinutes: row.prep_minutes === null ? null : Number(row.prep_minutes),
      cookMinutes: row.cook_minutes === null ? null : Number(row.cook_minutes),
      source: row.source === null ? null : String(row.source),
      steps: row.steps === null ? null : String(row.steps),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      lines: records(row.lines),
    })),
  };
}

async function readPantry(client: PoolClient): Promise<ToolResult> {
  const result = await client.query(
    `select ingredient_id, ingredient_name, stock_unit, is_hand_depleted,
            storage_location, total_quantity, oldest_acquired_on, lot_count
     from public.pantry_summary
     order by storage_location asc, ingredient_name asc, ingredient_id asc`
  );
  return {
    pantry: result.rows.map((row) => ({
      ingredientId: String(row.ingredient_id),
      ingredientName: String(row.ingredient_name),
      stockUnit: String(row.stock_unit),
      isHandDepleted: Boolean(row.is_hand_depleted),
      storageLocation: String(row.storage_location),
      totalQuantity: Number(row.total_quantity),
      oldestAcquiredOn: String(row.oldest_acquired_on),
      lotCount: Number(row.lot_count),
    })),
  };
}

async function readMealStock(client: PoolClient): Promise<ToolResult> {
  const result = await client.query(
    `select recipe_id, label, display_name, total_portions, oldest_cooked_on, batch_count
     from public.meal_stock
     order by oldest_cooked_on asc, display_name asc`
  );
  return {
    mealStock: result.rows.map((row) => ({
      recipeId: row.recipe_id === null ? null : String(row.recipe_id),
      label: row.label === null ? null : String(row.label),
      displayName: String(row.display_name),
      totalPortions: Number(row.total_portions),
      oldestCookedOn: String(row.oldest_cooked_on),
      batchCount: Number(row.batch_count),
    })),
  };
}

async function readMealLog(client: PoolClient): Promise<ToolResult> {
  const result = await client.query(
    `select log.id, log.occurred_on, log.meal_time, log.kind, log.recipe_id,
            coalesce(recipe.name, log.recipe_name) as recipe_name, log.note, log.created_at
     from public.meal_logs log
     left join public.recipes recipe on recipe.id = log.recipe_id
     order by log.occurred_on desc, log.created_at desc, log.id asc`
  );
  return {
    mealLogEntries: result.rows.map((row) => ({
      id: String(row.id),
      occurredOn: String(row.occurred_on),
      mealTime: row.meal_time === null ? null : String(row.meal_time),
      kind: String(row.kind),
      recipeId: row.recipe_id === null ? null : String(row.recipe_id),
      recipeName: row.recipe_name === null ? null : String(row.recipe_name),
      note: row.note === null ? null : String(row.note),
      createdAt: timestamp(row.created_at),
    })),
  };
}

async function readPreferences(client: PoolClient): Promise<ToolResult> {
  const result = await client.query(
    `select id, category, body, updated_at
     from public.preferences
     order by updated_at desc, id asc`
  );
  return { preferences: result.rows.map((row) => toPreference(row)) };
}

async function readCurrentMealSlots(client: PoolClient): Promise<ToolResult> {
  const result = await client.query(
    `select id, slot_date, meal_time, recipe_id, recipe_name, label, is_cook,
            cook_multiplier, cook_id, is_cookable, shortfall, line_statuses
     from public.meal_plan_slot_status
     where slot_date >= current_date
     order by slot_date asc, meal_time asc, id asc`
  );
  return {
    mealSlots: result.rows.map((row) => ({
      id: String(row.id),
      slotDate: String(row.slot_date),
      mealTime: String(row.meal_time),
      recipeId: row.recipe_id === null ? null : String(row.recipe_id),
      recipeName: row.recipe_name === null ? null : String(row.recipe_name),
      label: row.label === null ? null : String(row.label),
      isCook: Boolean(row.is_cook),
      cookMultiplier: Number(row.cook_multiplier),
      cookId: row.cook_id === null ? null : String(row.cook_id),
      isCookable: row.is_cookable === null ? null : Boolean(row.is_cookable),
      shortfall: Boolean(row.shortfall),
      lineStatuses: records(row.line_statuses).map((line) => ({
        recipeLineId: String(line.recipe_line_id),
        ingredientName: String(line.ingredient_name),
        status: String(line.status),
      })),
    })),
  };
}

async function createPreference(client: PoolClient, input: JsonObject): Promise<ToolResult> {
  const body = requiredNonBlankString(input.body, "body");
  const category = optionalString(input.category, "category");
  if (category !== undefined && category !== null && category.trim() === "") {
    throw new McpToolError(400, "category must be non-blank when provided");
  }
  const result = await client.query(
    `insert into public.preferences (body, category)
     values ($1, $2)
     returning id, category, body, updated_at`,
    [body, category ?? null]
  );
  return { preference: toPreference(result.rows[0]) };
}

async function updatePreference(client: PoolClient, input: JsonObject): Promise<ToolResult> {
  const id = requiredNonBlankString(input.id, "id");
  const hasBody = Object.hasOwn(input, "body");
  const hasCategory = Object.hasOwn(input, "category");
  if (!hasBody && !hasCategory) {
    throw new McpToolError(400, "Provide body or category to update a Preference");
  }

  const body = hasBody ? requiredNonBlankString(input.body, "body") : null;
  const category = hasCategory ? optionalString(input.category, "category") : undefined;
  if (category !== undefined && category !== null && category.trim() === "") {
    throw new McpToolError(400, "category must be non-blank when provided");
  }

  const result = await client.query(
    `update public.preferences
     set body = coalesce($2::text, body),
         category = case when $3::boolean then $4::text else category end
     where id = $1
     returning id, category, body, updated_at`,
    [id, body, hasCategory, category ?? null]
  );
  if (!result.rows[0]) throw new McpToolError(404, "Preference not found");
  return { preference: toPreference(result.rows[0]) };
}

async function deletePreference(client: PoolClient, input: JsonObject): Promise<ToolResult> {
  const id = requiredNonBlankString(input.id, "id");
  const result = await client.query(`delete from public.preferences where id = $1 returning id`, [id]);
  if (!result.rows[0]) throw new McpToolError(404, "Preference not found");
  return { deletedPreferenceId: String(result.rows[0].id) };
}

async function dispatchTool(
  client: PoolClient,
  name: AgentGatewayToolName | string,
  argumentsValue: unknown
): Promise<ToolResult> {
  const input = asObject(argumentsValue ?? {});
  switch (name) {
    case "larder_list_recipes":
      return readRecipes(client);
    case "larder_read_pantry":
      return readPantry(client);
    case "larder_read_meal_stock":
      return readMealStock(client);
    case "larder_read_meal_log":
      return readMealLog(client);
    case "larder_list_preferences":
      return readPreferences(client);
    case "larder_read_current_meal_slots":
      return readCurrentMealSlots(client);
    case "larder_create_preference":
      return createPreference(client, input);
    case "larder_update_preference":
      return updatePreference(client, input);
    case "larder_delete_preference":
      return deletePreference(client, input);
    default:
      // Do not expose a generic SQL/RPC bridge. In particular, the Agent
      // Runner cannot name Stock Lots, Portion Batches, Meal Log entries or
      // Shopping Items as a writable resource.
      throw new McpToolError(403, "Unknown or forbidden MCP tool");
  }
}

/** Authenticate a token before exposing even the otherwise-static tool list. */
export async function listAgentGatewayTools(secret: string) {
  return withAgentToken(secret, async () => ({ tools: AGENT_GATEWAY_TOOLS }));
}

/** Execute exactly one documented MCP tool in a token-owner RLS session. */
export async function callAgentGatewayTool(
  secret: string,
  name: string,
  argumentsValue: unknown
): Promise<ToolResult> {
  return withAgentToken(secret, (client) => dispatchTool(client, name, argumentsValue));
}
