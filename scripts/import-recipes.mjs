#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { parseCookLog } from "./import-second-brain.mjs";
import { parseRecipeMarkdown } from "./recipe-parser.mjs";

const { Pool } = pg;

function normalise(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function walkMarkdown(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!new Set([".git", "node_modules", ".kiro"]).has(entry.name)) {
        files.push(...await walkMarkdown(fullPath, root));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push({ fullPath, relativePath: path.relative(root, fullPath) });
    }
  }
  return files;
}

async function registrySnapshot(client) {
  const [{ rows: ingredients }, { rows: aliases }, { rows: conversions }] = await Promise.all([
    client.query("select id, name, stock_unit, is_hand_depleted from public.ingredients where status = 'active' order by name"),
    client.query("select ingredient_id, alias from public.ingredient_aliases"),
    client.query("select ingredient_id, from_unit, factor_to_stock_unit from public.unit_conversions"),
  ]);
  const aliasesByIngredient = new Map();
  const conversionsByIngredient = new Map();
  for (const row of aliases) {
    const values = aliasesByIngredient.get(row.ingredient_id) ?? [];
    values.push(row.alias);
    aliasesByIngredient.set(row.ingredient_id, values);
  }
  for (const row of conversions) {
    const values = conversionsByIngredient.get(row.ingredient_id) ?? [];
    values.push({ fromUnit: row.from_unit, factorToStockUnit: Number(row.factor_to_stock_unit) });
    conversionsByIngredient.set(row.ingredient_id, values);
  }
  return ingredients.map((row) => ({
    id: row.id,
    name: row.name,
    stockUnit: row.stock_unit,
    isHandDepleted: row.is_hand_depleted,
    aliases: aliasesByIngredient.get(row.id) ?? [],
    conversions: conversionsByIngredient.get(row.id) ?? [],
  }));
}

function isRecipeMarkdown(markdown) {
  return /^#{1,6}\s+ingredients\s*#*\s*$/im.test(markdown);
}

/** Reads recipe files only; setup docs and Shop Config tables are ignored. */
export async function loadRecipeImportPlan(vaultPath, registry) {
  const files = await walkMarkdown(vaultPath);
  const recipes = [];
  for (const file of files) {
    const markdown = await readFile(file.fullPath, "utf8");
    if (!isRecipeMarkdown(markdown)) continue;
    const parsed = parseRecipeMarkdown(markdown, registry);
    recipes.push({
      relativePath: file.relativePath,
      sourceKey: createHash("sha256").update(`recipe:${file.relativePath}`).digest("hex"),
      ...parsed,
      cookLogs: parseCookLog(file.relativePath, markdown),
    });
  }
  return recipes.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function mappingProposals(recipes) {
  return recipes.flatMap((entry) => entry.inconsistencies.map((inconsistency) => ({
    recipe: entry.recipe.name,
    sourcePath: entry.relativePath,
    line: inconsistency.line + 1,
    rawName: inconsistency.rawName,
    reason: inconsistency.reason,
    candidates: inconsistency.candidates,
  })));
}

export function printRecipeImportPlan(recipes) {
  const proposals = mappingProposals(recipes);
  console.log("Dry run — no database writes made.");
  console.log(`Recipes (${recipes.length})`);
  for (const entry of recipes) {
    console.log(`  ${entry.recipe.name}: ${entry.recipe.lines.length} lines, ${entry.inconsistencies.length} Inconsistencies (${entry.relativePath})`);
  }
  console.log(`\nMapping proposals requiring confirmation (${proposals.length})`);
  for (const proposal of proposals) console.log(`  ${JSON.stringify(proposal)}`);
  console.log("\nResolved exact names and aliases will import directly. Proposed mappings are never applied automatically; resolve them in the mobile queue after confirming this import.");
}

async function ensureRecipeTag(client, recipeId, tag) {
  const existing = await client.query(
    "select 1 from public.recipe_tags where recipe_id = $1 and lower(btrim(tag)) = lower(btrim($2))",
    [recipeId, tag]
  );
  if (!existing.rowCount) {
    await client.query("insert into public.recipe_tags (recipe_id, tag) values ($1, $2)", [recipeId, tag]);
  }
}

/**
 * Writes only recipes absent by immutable source key. Re-running is safe:
 * existing Recipes and their Lines remain untouched, while Cook Log rows are
 * linked to the imported Recipe through their own stable source identity.
 */
export async function writeRecipeImportPlan(recipes, databaseUrl) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to apply recipe import.");
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const idsByName = new Map();
    for (const entry of recipes) {
      const existing = await client.query("select id from public.recipes where source_key = $1", [entry.sourceKey]);
      let recipeId = existing.rows[0]?.id;
      if (!recipeId) {
        const recipe = entry.recipe;
        const created = await client.query(
          `insert into public.recipes
             (name, servings, max_multiplier, rating, prep_minutes, cook_minutes, source, steps, status, source_key)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9)
           returning id`,
          [recipe.name, recipe.servings, recipe.maxMultiplier, recipe.rating, recipe.prepMinutes, recipe.cookMinutes, recipe.source, recipe.steps, entry.sourceKey]
        );
        recipeId = created.rows[0].id;
        for (const tag of recipe.tags) await ensureRecipeTag(client, recipeId, tag);
        for (const [position, line] of recipe.lines.entries()) {
          await client.query(
            `insert into public.recipe_lines
               (recipe_id, ingredient_id, raw_name, amount, unit, note, position)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [recipeId, line.ingredientId, line.rawName, line.amount, line.unit, line.note, position]
          );
        }
      }
      idsByName.set(normalise(entry.recipe.name), recipeId);
      for (const log of entry.cookLogs) {
        const logSourceKey = createHash("sha256").update(log.sourceKey).digest("hex");
        const note = log.note ? `×${log.multiplier} — ${log.note}` : `×${log.multiplier}`;
        await client.query(
          `insert into public.meal_logs (occurred_on, kind, recipe_id, recipe_name, note, source_key)
           values ($1::date, 'eaten', $2, $3, $4, $5)
           on conflict (source_key) where source_key is not null
           do update set recipe_id = excluded.recipe_id, recipe_name = excluded.recipe_name`,
          [log.occurredOn, recipeId, entry.recipe.name, note, logSourceKey]
        );
      }
    }
    await client.query("commit");
    return idsByName;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const vaultPath = option(args, "--vault");
  if (!vaultPath) {
    throw new Error("Usage: node scripts/import-recipes.mjs --vault <SecondBrain path> [--apply --confirm-import]");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to read the Ingredient Registry.");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let registry;
  try {
    registry = await registrySnapshot(client);
  } finally {
    client.release();
    await pool.end();
  }
  const recipes = await loadRecipeImportPlan(vaultPath, registry);
  printRecipeImportPlan(recipes);
  if (!args.includes("--apply")) return;
  if (!args.includes("--confirm-import")) {
    throw new Error("No writes made. Review mapping proposals, then rerun with --apply --confirm-import.");
  }
  await writeRecipeImportPlan(recipes, process.env.DATABASE_URL);
  console.log("\nRecipe import complete. Re-running this command keeps Recipes, Lines and Meal Log history unique by source key.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
