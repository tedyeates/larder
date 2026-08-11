#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;
const HAND_DEPLETED_CATEGORIES = /\b(oils?|sauces?|condiments?)\b/i;
const STORAGE_LOCATIONS = new Map([
  ["fridge", "fridge"],
  ["freezer", "freezer"],
  ["cupboard", "cupboard"],
  ["counter", "counter"],
  ["household", "household"],
  ["medicine", "medicine"],
]);

function normalise(value) {
  // Deliberately not toLocaleLowerCase: the host locale must not change what
  // this importer considers the same Ingredient, Aisle or unit.
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Units match when they differ only by a trailing plural s ("clove"/"cloves"). */
function sameUnit(left, right) {
  const from = normalise(left);
  const to = normalise(right);
  return from === to || `${from}s` === to || from === `${to}s`;
}

function cleanCell(value) {
  return value.trim().replace(/^`|`$/g, "").replace(/<br\s*\/?>/gi, " ").trim();
}

function parseTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cleanCell);
  return cells.length > 0 && cells[0] !== "" ? cells : null;
}

function isSeparator(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function markdownTables(markdown) {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const tables = [];
  let heading = "";

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (headingMatch) heading = headingMatch[1].trim();

    const header = parseTableRow(lines[index]);
    const separator = parseTableRow(lines[index + 1] ?? "");
    if (!header || !separator || !isSeparator(separator)) continue;

    const rows = [];
    index += 2;
    while (index < lines.length) {
      const row = parseTableRow(lines[index]);
      if (!row) break;
      rows.push(row);
      index += 1;
    }
    index -= 1;
    tables.push({ heading, headers: header.map(normalise), rows });
  }

  return tables;
}

function firstHeaderIndex(headers, candidates) {
  return headers.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)));
}

function uniqueBy(values, key) {
  const seen = new Set();
  return values.filter((value) => {
    const valueKey = key(value);
    if (seen.has(valueKey)) return false;
    seen.add(valueKey);
    return true;
  });
}

/** Parse `.kiro/formats/units.md` without guessing omitted factors or units. */
export function parseUnits(markdown) {
  const ingredients = [];
  const defaults = {};

  for (const table of markdownTables(markdown)) {
    const ingredientIndex = firstHeaderIndex(table.headers, ["ingredient", "item", "name"]);
    const unitIndex = firstHeaderIndex(table.headers, ["stock unit", "unit"]);
    const categoryIndex = firstHeaderIndex(table.headers, ["category", "type", "group"]);
    const isDefaults = /\bdefaults?\b/i.test(table.heading);

    if (unitIndex < 0) continue;
    for (const row of table.rows) {
      const unit = cleanCell(row[unitIndex] ?? "");
      if (!unit) continue;
      const category = cleanCell(categoryIndex >= 0 ? row[categoryIndex] ?? "" : "");

      if (isDefaults) {
        const defaultCategory = category || cleanCell(row[0] ?? "");
        if (defaultCategory) defaults[normalise(defaultCategory)] = unit;
        continue;
      }

      if (ingredientIndex < 0) continue;
      const name = cleanCell(row[ingredientIndex] ?? "");
      if (!name) continue;
      ingredients.push({
        name,
        stockUnit: unit,
        isHandDepleted: HAND_DEPLETED_CATEGORIES.test(`${table.heading} ${category}`),
      });
    }
  }

  const dedupedIngredients = uniqueBy(ingredients, (ingredient) => normalise(ingredient.name));
  const conversions = [];
  const conversionPattern = /^\s*[-*]\s*1\s+(.+?)\s*(?:≈|~=|=)\s*(\d+(?:\.\d+)?)\s*([\p{L}]+)\s*$/u;

  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(conversionPattern);
    if (!match) continue;
    const [, sourcePhrase, factorText, targetUnit] = match;
    const sourceWords = normalise(sourcePhrase).split(" ");
    const candidates = dedupedIngredients
      .map((ingredient) => ({ ingredient, words: normalise(ingredient.name).split(" ") }))
      .sort((left, right) => right.words.length - left.words.length);
    const candidate = candidates.find(({ words }) => {
      const atStart = sourceWords.slice(0, words.length).join(" ") === words.join(" ");
      const atEnd = sourceWords.slice(-words.length).join(" ") === words.join(" ");
      return (atStart || atEnd) && sourceWords.length === words.length + 1;
    });
    if (!candidate) continue;
    // A factor is only a Convertible Unit if it lands in the Ingredient's own
    // Stock Unit; storing one that lands anywhere else would silently corrupt
    // every later depletion, so it aborts instead.
    if (!sameUnit(targetUnit, candidate.ingredient.stockUnit)) {
      throw new Error(
        `Conversion note "1 ${sourcePhrase}" gives a factor to ${targetUnit}, but ${candidate.ingredient.name} is stocked in ${candidate.ingredient.stockUnit}; fix units.md.`
      );
    }
    const startsWithIngredient = sourceWords.slice(0, candidate.words.length).join(" ") === candidate.words.join(" ");
    const fromUnit = startsWithIngredient
      ? sourceWords.slice(candidate.words.length).join(" ")
      : sourceWords.slice(0, -candidate.words.length).join(" ");
    conversions.push({
      ingredientName: candidate.ingredient.name,
      fromUnit,
      factorToStockUnit: Number(factorText),
    });
  }

  return {
    ingredients: dedupedIngredients,
    defaults,
    conversions: uniqueBy(conversions, (conversion) => `${normalise(conversion.ingredientName)}:${normalise(conversion.fromUnit)}`),
  };
}

function headingAisle(heading) {
  const match = heading.match(/^(.+?)\s+(.+)$/u);
  if (!match || /^[\p{L}\p{N}\s]+$/u.test(match[1])) return null;
  return { emoji: match[1].trim(), name: match[2].trim() };
}

/** Parse one Shop Config markdown file into ordered Aisles and Placements. */
export function parseShopConfig(name, markdown) {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const aisles = [];
  const placements = [];
  let currentAisle = null;

  const addAisle = (aisleName, emoji) => {
    const existing = aisles.find((aisle) => normalise(aisle.name) === normalise(aisleName));
    if (existing) return existing;
    const aisle = { name: aisleName.trim(), emoji: emoji.trim(), position: aisles.length };
    aisles.push(aisle);
    return aisle;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^#{2,6}\s+(.+?)\s*#*$/);
    if (headingMatch) {
      const parsed = headingAisle(headingMatch[1].trim());
      currentAisle = parsed ? addAisle(parsed.name, parsed.emoji) : null;
      continue;
    }

    const headers = parseTableRow(lines[index]);
    const separator = parseTableRow(lines[index + 1] ?? "");
    if (headers && separator && isSeparator(separator)) {
      const normalisedHeaders = headers.map(normalise);
      const ingredientIndex = firstHeaderIndex(normalisedHeaders, ["ingredient", "item", "name"]);
      const aisleIndex = firstHeaderIndex(normalisedHeaders, ["aisle", "section"]);
      index += 2;
      while (index < lines.length) {
        const row = parseTableRow(lines[index]);
        if (!row) break;
        const ingredientName = cleanCell(row[ingredientIndex >= 0 ? ingredientIndex : 0] ?? "");
        const aisleName = cleanCell(row[aisleIndex] ?? currentAisle?.name ?? "");
        if (ingredientName && aisleName) placements.push({ ingredientName, aisleName });
        index += 1;
      }
      index -= 1;
      continue;
    }

    const bullet = lines[index].match(/^\s*[-*]\s+(.+?)\s*$/);
    if (bullet && currentAisle && !bullet[1].includes("≈")) {
      placements.push({ ingredientName: cleanCell(bullet[1]), aisleName: currentAisle.name });
    }
  }

  return {
    name,
    aisles,
    placements: uniqueBy(placements, (placement) => `${normalise(placement.ingredientName)}:${normalise(placement.aisleName)}`),
  };
}

function parseCsv(csv) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function parseQuantity(text) {
  const match = text.trim().match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s+(.+)$/);
  if (!match) return null;
  const number = match[1].includes("/")
    ? match[1].split("/").reduce((value, part, index) => (index === 0 ? Number(part) : value / Number(part)), 0)
    : Number(match[1]);
  return Number.isFinite(number) && number > 0 ? { quantity: number, stockUnit: match[2].trim() } : null;
}

function parseStorageLocation(value) {
  const normalized = normalise(value).replace(/^[^\p{L}\p{N}]+/u, "");
  const exact = STORAGE_LOCATIONS.get(normalized);
  if (exact) return exact;
  throw new Error(`Unknown TickTick storage column "${value}"; use Fridge, Freezer, Cupboard, Counter, Household or Medicine.`);
}

/** Parse TickTick CSV export rows; location always comes from its column, never the title emoji. */
export function parseTickTickCsv(csv) {
  const rows = parseCsv(csv);
  const headerIndexes = (row) => {
    const headers = row.map((header) => normalise(header.replace(/^\uFEFF/, "")));
    return {
      titleIndex: firstHeaderIndex(headers, ["title", "task"]),
      columnIndex: firstHeaderIndex(headers, ["column", "section"]),
      createdIndex: firstHeaderIndex(headers, ["createdtime", "created time", "created_at"]),
    };
  };
  // A TickTick export opens with metadata lines ("Date: ...", "Version: ...")
  // before the real header row, so the header is found rather than assumed.
  const headerRow = rows.findIndex((row) => Object.values(headerIndexes(row)).every((index) => index >= 0));
  if (headerRow < 0) throw new Error("TickTick CSV needs title, column and createdTime columns.");
  const { titleIndex, columnIndex, createdIndex } = headerIndexes(rows[headerRow]);

  return rows.slice(headerRow + 1).map((row) => {
    const title = cleanCell(row[titleIndex] ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
    const separator = title.indexOf("—");
    if (separator < 0) throw new Error(`TickTick task "${title}" must use “Ingredient — quantity” or “Ingredient — staple”.`);
    const ingredientName = title.slice(0, separator).trim();
    const amount = title.slice(separator + 1).trim();
    const createdTime = cleanCell(row[createdIndex] ?? "");
    const acquiredOn = createdTime.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (!ingredientName || !acquiredOn) throw new Error(`TickTick task "${title}" has no usable name or createdTime.`);

    const common = {
      ingredientName,
      storageLocation: parseStorageLocation(cleanCell(row[columnIndex] ?? "")),
      acquiredOn,
    };
    if (normalise(amount) === "staple") return { ...common, isHandDepleted: true };
    const quantity = parseQuantity(amount);
    if (!quantity) throw new Error(`TickTick task "${title}" has an invalid quantity.`);
    return { ...common, ...quantity, isHandDepleted: false };
  });
}

function recipeNameFromMarkdown(markdown, filePath) {
  const frontmatter = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const title = frontmatter?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
  if (title) return title;
  const heading = markdown.match(/^#\s+(.+?)\s*#*$/m)?.[1]?.trim();
  return heading || path.basename(filePath, path.extname(filePath));
}

/** Parse documented Cook Log rows under a recipe's Cook Log section only. */
export function parseCookLog(relativePath, markdown) {
  const recipeName = recipeNameFromMarkdown(markdown, relativePath);
  const lines = markdown.split(/\r?\n/);
  const entries = [];
  let inCookLog = false;

  lines.forEach((line, index) => {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      if (/^cook log$/i.test(heading[1].trim())) inCookLog = true;
      else if (inCookLog) inCookLog = false;
      return;
    }
    if (!inCookLog) return;
    const match = line.match(/^\s*-\s*(\d{4}-\d{2}-\d{2})\s*\|\s*[×x]\s*(\d+)\s*(?:\|\s*(.+?))?\s*$/u);
    if (!match) return;
    const note = match[3]?.trim().replace(/^"|"$/g, "") || null;
    entries.push({
      recipeName,
      occurredOn: match[1],
      multiplier: Number(match[2]),
      note,
      sourceKey: `${relativePath}:${index + 1}`,
    });
  });

  return entries;
}

/** Read tag list for dry-run review. No global tag table exists yet, so tags are not written. */
export function parseTagVocabulary(markdown) {
  const tags = markdown.split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+?)\s*$/)?.[1])
    .filter((tag) => tag && !tag.startsWith("["))
    .map((tag) => cleanCell(tag));
  return uniqueBy(tags, normalise);
}

/** Parse preference/restriction bullets, using nested headings as categories. */
export function parsePreferences(sourceName, markdown) {
  let category = sourceName;
  const preferences = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{2,6}\s+(.+?)\s*#*$/);
    if (heading) {
      category = heading[1].trim();
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/);
    if (!bullet) continue;
    const body = cleanCell(bullet[1]);
    if (body) preferences.push({ category, body });
  }
  return uniqueBy(preferences, (preference) => `${normalise(preference.category)}:${normalise(preference.body)}`);
}

function defaultUnitForAisle(defaults, aisleName) {
  const needle = normalise(aisleName);
  const entry = Object.entries(defaults).find(([category]) => category === needle || category.includes(needle) || needle.includes(category));
  return entry?.[1] ?? null;
}

/** Merge parsed sources. Missing unit information aborts before any DB connection/write. */
export function buildImportPlan({ units, shops, pantry, mealLogs, preferences, tags }) {
  const ingredients = [...units.ingredients];
  const byName = new Map(ingredients.map((ingredient) => [normalise(ingredient.name), ingredient]));
  const addIngredient = (name, stockUnit, isHandDepleted) => {
    const key = normalise(name);
    const existing = byName.get(key);
    if (existing) {
      if (stockUnit && normalise(existing.stockUnit) !== normalise(stockUnit)) {
        throw new Error(`Conflicting Stock Units for ${name}: ${existing.stockUnit} and ${stockUnit}.`);
      }
      if (isHandDepleted) existing.isHandDepleted = true;
      return;
    }
    if (!stockUnit) throw new Error(`No Stock Unit for ${name}; add it to units.md or a matching Defaults category.`);
    const ingredient = { name, stockUnit, isHandDepleted };
    ingredients.push(ingredient);
    byName.set(key, ingredient);
  };

  for (const lot of pantry) addIngredient(lot.ingredientName, lot.stockUnit, lot.isHandDepleted);
  const placements = [];
  for (const shop of shops) {
    const shopAisles = new Set(shop.aisles.map((aisle) => normalise(aisle.name)));
    for (const placement of shop.placements) {
      // Aisles carry a mandatory emoji, so one named only by an item table
      // cannot be invented here. Fail in the plan, not mid-write.
      if (!shopAisles.has(normalise(placement.aisleName))) {
        throw new Error(
          `${shop.name} places ${placement.ingredientName} in Aisle "${placement.aisleName}", which has no emoji heading in that Shop Config; add the heading so the Aisle can be created.`
        );
      }
      const unit = defaultUnitForAisle(units.defaults, placement.aisleName);
      addIngredient(placement.ingredientName, unit, false);
      placements.push({ ingredientName: placement.ingredientName, shopName: shop.name, aisleName: placement.aisleName });
    }
  }

  return {
    ingredients: uniqueBy(ingredients, (ingredient) => normalise(ingredient.name)),
    conversions: units.conversions,
    shops: shops.map((shop) => ({ name: shop.name, aisles: shop.aisles })),
    placements: uniqueBy(placements, (placement) => `${normalise(placement.ingredientName)}:${normalise(placement.shopName)}:${normalise(placement.aisleName)}`),
    lots: pantry.filter((lot) => !lot.isHandDepleted).map(({ ingredientName, quantity, storageLocation, acquiredOn }) => ({ ingredientName, quantity, storageLocation, acquiredOn })),
    mealLogs,
    preferences,
    tags,
  };
}

async function walkMarkdown(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (![".git", "node_modules", ".kiro"].includes(entry.name)) files.push(...await walkMarkdown(fullPath, root));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push({ fullPath, relativePath: path.relative(root, fullPath) });
    }
  }
  return files;
}

async function loadPlanFromFiles(vaultPath, tickTickPath) {
  const file = (...parts) => readFile(path.join(vaultPath, ...parts), "utf8");
  const [unitsMarkdown, tagsMarkdown, preferencesMarkdown, restrictionsMarkdown, tickTickCsv, ...shopMarkdown] = await Promise.all([
    file(".kiro", "formats", "units.md"),
    file(".kiro", "formats", "tags.md"),
    file("Preferences.md"),
    file("Restrictions.md"),
    readFile(tickTickPath, "utf8"),
    file("🌮 Food", "Shop Config", "Lidl.md"),
    file("🌮 Food", "Shop Config", "Tesco.md"),
    file("🌮 Food", "Shop Config", "Asian Supermarket.md"),
  ]);
  const cookLogs = [];
  for (const recipeFile of await walkMarkdown(vaultPath)) {
    if (recipeFile.relativePath.startsWith(".kiro/") || recipeFile.relativePath.includes("Shop Config/")) continue;
    cookLogs.push(...parseCookLog(recipeFile.relativePath, await readFile(recipeFile.fullPath, "utf8")));
  }
  return buildImportPlan({
    units: parseUnits(unitsMarkdown),
    shops: [parseShopConfig("Lidl", shopMarkdown[0]), parseShopConfig("Tesco", shopMarkdown[1]), parseShopConfig("Asian Supermarket", shopMarkdown[2])],
    pantry: parseTickTickCsv(tickTickCsv),
    mealLogs: cookLogs,
    preferences: [...parsePreferences("Preferences", preferencesMarkdown), ...parsePreferences("Restrictions", restrictionsMarkdown)],
    tags: parseTagVocabulary(tagsMarkdown),
  });
}

function printPlan(plan) {
  const groups = [
    ["Ingredients", plan.ingredients], ["Convertible Units", plan.conversions], ["Shops", plan.shops],
    ["Placements", plan.placements], ["Stock Lots", plan.lots], ["Historical Meal Logs", plan.mealLogs],
    ["Preferences", plan.preferences], ["Tag vocabulary (reference only; no table yet)", plan.tags],
  ];
  console.log("Dry run — no database writes made.");
  for (const [label, values] of groups) {
    console.log(`\n${label} (${values.length})`);
    for (const value of values) console.log(`  ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
}

async function ensureIngredient(client, ingredient) {
  const existing = await client.query(
    "select id, stock_unit, is_hand_depleted from public.ingredients where lower(btrim(name)) = lower(btrim($1))",
    [ingredient.name]
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (normalise(row.stock_unit) !== normalise(ingredient.stockUnit)) {
      throw new Error(`Existing Ingredient ${ingredient.name} uses Stock Unit ${row.stock_unit}, not ${ingredient.stockUnit}.`);
    }
    if (ingredient.isHandDepleted && !row.is_hand_depleted) {
      await client.query("update public.ingredients set is_hand_depleted = true where id = $1", [row.id]);
    }
    return row.id;
  }
  const created = await client.query(
    "insert into public.ingredients (name, stock_unit, is_hand_depleted) values ($1, $2, $3) returning id",
    [ingredient.name, ingredient.stockUnit, ingredient.isHandDepleted]
  );
  return created.rows[0].id;
}

async function ensureShop(client, name) {
  const existing = await client.query("select id from public.shops where lower(btrim(name)) = lower(btrim($1))", [name]);
  if (existing.rowCount) return existing.rows[0].id;
  const created = await client.query(
    "insert into public.shops (name, position) values ($1, coalesce((select max(position) + 1 from public.shops), 0)) returning id",
    [name]
  );
  return created.rows[0].id;
}

async function ensureAisle(client, shopId, aisle) {
  const existing = await client.query(
    "select id from public.aisles where shop_id = $1 and lower(btrim(name)) = lower(btrim($2))",
    [shopId, aisle.name]
  );
  if (existing.rowCount) return existing.rows[0].id;
  const created = await client.query(
    "insert into public.aisles (shop_id, name, emoji, position) values ($1, $2, $3, coalesce((select max(position) + 1 from public.aisles where shop_id = $1), 0)) returning id",
    [shopId, aisle.name, aisle.emoji]
  );
  return created.rows[0].id;
}

async function writePlan(plan, databaseUrl) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to apply this import.");
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const ingredientIds = new Map();
    for (const ingredient of plan.ingredients) ingredientIds.set(normalise(ingredient.name), await ensureIngredient(client, ingredient));
    for (const conversion of plan.conversions) {
      await client.query(
        "insert into public.unit_conversions (ingredient_id, from_unit, factor_to_stock_unit) values ($1, $2, $3) on conflict (ingredient_id, lower(btrim(from_unit))) do nothing",
        [ingredientIds.get(normalise(conversion.ingredientName)), conversion.fromUnit, conversion.factorToStockUnit]
      );
    }
    const aisleIds = new Map();
    for (const shop of plan.shops) {
      const shopId = await ensureShop(client, shop.name);
      for (const aisle of shop.aisles) aisleIds.set(`${normalise(shop.name)}:${normalise(aisle.name)}`, await ensureAisle(client, shopId, aisle));
    }
    for (const placement of plan.placements) {
      await client.query(
        "insert into public.placements (ingredient_id, aisle_id) values ($1, $2) on conflict (ingredient_id, aisle_id) do nothing",
        [ingredientIds.get(normalise(placement.ingredientName)), aisleIds.get(`${normalise(placement.shopName)}:${normalise(placement.aisleName)}`)]
      );
    }
    for (const lot of plan.lots) {
      await client.query(
        "insert into public.stock_lots (ingredient_id, quantity, storage_location, acquired_on) values ($1, $2, $3::public.storage_location, $4::date) on conflict (ingredient_id, storage_location, acquired_on) do nothing",
        [ingredientIds.get(normalise(lot.ingredientName)), lot.quantity, lot.storageLocation, lot.acquiredOn]
      );
    }
    for (const preference of plan.preferences) {
      const existing = await client.query(
        "select 1 from public.preferences where category is not distinct from $1 and body = $2",
        [preference.category, preference.body]
      );
      if (!existing.rowCount) await client.query("insert into public.preferences (category, body) values ($1, $2)", [preference.category, preference.body]);
    }
    for (const mealLog of plan.mealLogs) {
      const note = mealLog.note ? `×${mealLog.multiplier} — ${mealLog.note}` : `×${mealLog.multiplier}`;
      await client.query(
        "insert into public.meal_logs (occurred_on, kind, recipe_name, note, source_key) values ($1::date, 'eaten', $2, $3, $4) on conflict (source_key) where source_key is not null do nothing",
        [mealLog.occurredOn, mealLog.recipeName, note, createHash("sha256").update(mealLog.sourceKey).digest("hex")]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const vaultPath = option(args, "--vault");
  const tickTickPath = option(args, "--ticktick");
  if (!vaultPath || !tickTickPath) {
    throw new Error("Usage: node scripts/import-second-brain.mjs --vault <SecondBrain path> --ticktick <Pantry.csv> [--apply --confirm-import]");
  }
  const plan = await loadPlanFromFiles(vaultPath, tickTickPath);
  printPlan(plan);
  if (!args.includes("--apply")) return;
  if (!args.includes("--confirm-import")) {
    throw new Error("No writes made. Review dry run, then rerun with --apply --confirm-import to confirm this exact import.");
  }
  await writePlan(plan, process.env.DATABASE_URL);
  console.log("\nImport complete. Re-running this command is safe: existing Ingredients, Shops, Aisles, Placements, Lots, Preferences and Meal Logs are not duplicated.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { loadPlanFromFiles, printPlan, writePlan };
