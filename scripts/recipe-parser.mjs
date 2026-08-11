/**
 * Deterministic Recipe Parser (#12).
 *
 * Markdown plus a Registry snapshot goes in; parsed Recipe data and every
 * arithmetic-blocking Inconsistency comes out. Exact Ingredient names and
 * known Aliases resolve, while fuzzy candidates remain suggestions only.
 */

function normalise(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function clean(value) {
  return value.trim().replace(/^`|`$/g, "").trim();
}

function sameUnit(left, right) {
  const a = normalise(left);
  const b = normalise(right);
  return a === b || `${a}s` === b || a === `${b}s`;
}

function parseFrontmatter(markdown) {
  const match = markdown.replace(/^\uFEFF/, "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { values: {}, body: markdown };

  const values = {};
  let currentList = null;
  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^\s*([^:#][^:]*):\s*(.*?)\s*$/);
    if (entry) {
      const key = normalise(entry[1]).replace(/[-_]/g, " ");
      const value = clean(entry[2]);
      currentList = value === "" ? key : null;
      if (value === "") values[key] = [];
      else if (/^\[.*\]$/.test(value)) values[key] = value.slice(1, -1).split(",").map(clean).filter(Boolean);
      else values[key] = value.replace(/^['"]|['"]$/g, "");
      continue;
    }
    const listItem = line.match(/^\s*-\s+(.+?)\s*$/);
    if (listItem && currentList) values[currentList].push(clean(listItem[1]).replace(/^['"]|['"]$/g, ""));
  }

  return { values, body: markdown.slice(match[0].length) };
}

function parseTableRow(line) {
  if (!line.includes("|")) return null;
  const values = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(clean);
  return values.length > 0 ? values : null;
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function sections(markdown) {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const found = [];
  let current = null;

  lines.forEach((line, index) => {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      if (current) current.end = index;
      current = { name: heading[1].trim(), key: normalise(heading[1]), start: index + 1, end: lines.length };
      found.push(current);
    }
  });

  return { lines, found };
}

function fieldIndex(headers, names) {
  return headers.findIndex((header) => names.some((name) => header === name || header.includes(name)));
}

function fraction(value) {
  const text = clean(value);
  const match = text.match(/^(?:(\d+)\s+)?(\d+(?:\.\d+)?|\d+\/\d+)$/);
  if (!match) return null;
  const whole = Number(match[1] ?? 0);
  const part = match[2].includes("/")
    ? match[2].split("/").reduce((total, item, index) => index === 0 ? Number(item) : total / Number(item), 0)
    : Number(match[2]);
  const result = whole + part;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function parseQuantity(amountCell, unitCell) {
  const amountText = clean(amountCell ?? "");
  const unitText = clean(unitCell ?? "");
  const isDash = /^(?:—|–|-)$/.test(amountText);
  if (amountText === "" || isDash) return { amount: null, unit: null };

  const plainAmount = fraction(amountText);
  if (plainAmount !== null) return { amount: plainAmount, unit: /^(?:—|–|-)$/.test(unitText) || unitText === "" ? null : unitText };

  // Existing files sometimes put "2 tbsp" in one Amount cell. Parsing that
  // shape is safe because it is still explicit; it never invents a factor.
  const combined = amountText.match(/^(?:(\d+)\s+)?(\d+(?:\.\d+)?|\d+\/\d+)\s+(.+)$/);
  // No number anywhere ("to taste"): the line is Unmeasured. The stated unit
  // is dropped deliberately — recipe_lines rejects a unit with no amount, so
  // keeping it would abort the whole import instead of flagging one line.
  if (!combined) return { amount: null, unit: null, invalidAmount: amountText };
  const numeric = fraction(`${combined[1] ? `${combined[1]} ` : ""}${combined[2]}`);
  return { amount: numeric, unit: unitText || clean(combined[3]) || null };
}

function candidateScore(query, name) {
  const left = normalise(query);
  const right = normalise(name);
  if (right.startsWith(`${left} `) || left.startsWith(`${right} `)) return 0.9;
  const grams = (value) => {
    const padded = `  ${value}  `;
    return new Set(Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) => padded.slice(index, index + 3)));
  };
  const a = grams(left);
  const b = grams(right);
  const common = [...a].filter((gram) => b.has(gram)).length;
  return a.size + b.size === 0 ? 0 : (2 * common) / (a.size + b.size);
}

function resolveIngredient(rawName, registry) {
  const name = normalise(rawName);
  const exact = registry.find((ingredient) => normalise(ingredient.name) === name);
  if (exact) return { ingredient: exact, matchKind: "exact", candidates: [] };
  const alias = registry.find((ingredient) => (ingredient.aliases ?? []).some((value) => normalise(value) === name));
  if (alias) return { ingredient: alias, matchKind: "alias", candidates: [] };

  const candidates = registry
    .map((ingredient) => ({ ingredientId: ingredient.id, name: ingredient.name, matchKind: "fuzzy", score: candidateScore(rawName, ingredient.name) }))
    .filter((candidate) => candidate.score > 0.2)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 5);
  return { ingredient: null, matchKind: null, candidates };
}

function recipeName(values, body) {
  if (typeof values.title === "string" && values.title.trim()) return values.title.trim();
  return body.match(/^#\s+(.+?)\s*#*$/m)?.[1]?.trim() ?? "Untitled Recipe";
}

function minutes(value) {
  if (typeof value !== "string") return null;
  // "1h 30m", "20 minutes" and a bare "10" all appear in the existing files.
  const hours = value.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i);
  const mins = value.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/i);
  if (hours) return Math.round(Number(hours[1]) * 60 + Number(mins?.[1] ?? 0));
  if (mins) return Math.round(Number(mins[1]));
  const bare = value.match(/\d+(?:\.\d+)?/);
  return bare ? Math.round(Number(bare[0])) : null;
}

/** recipes.rating is 1-5; anything else is not a rating, not a rating to guess. */
function rating(value) {
  if (typeof value !== "string") return null;
  const parsed = Number(value.match(/^\s*(\d+)/)?.[1] ?? NaN);
  return parsed >= 1 && parsed <= 5 ? parsed : null;
}

function parseCookLog(section, lines) {
  if (!section) return [];
  const entries = [];
  for (let index = section.start; index < section.end; index += 1) {
    const match = lines[index].match(/^\s*-\s*(\d{4}-\d{2}-\d{2})\s*\|\s*[×x]\s*(\d+)\s*(?:\|\s*(.+?))?\s*$/u);
    if (!match) continue;
    entries.push({
      occurredOn: match[1],
      multiplier: Number(match[2]),
      note: match[3]?.trim().replace(/^"|"$/g, "") || null,
      line: index,
    });
  }
  return entries;
}

/**
 * Parse one recipe markdown file using an immutable Registry snapshot.
 * Registry entries need `id`, `name`, `stockUnit`, `isHandDepleted`, and
 * optionally `aliases` and `conversions` (`fromUnit` values). No database
 * calls occur here, which keeps the function deterministic and testable.
 *
 * Inconsistency reasons mirror the recipe_line_inconsistencies view, plus
 * `invalid_amount` for an Amount cell holding no number at all. That one is
 * dry-run-only: such a line is stored Unmeasured, so the view re-derives it
 * as unmeasured_on_auto_depleted (or as legal, for a Hand-Depleted Ingredient).
 */
export function parseRecipeMarkdown(markdown, registry) {
  const { values, body } = parseFrontmatter(markdown);
  const { lines, found } = sections(body);
  const ingredientsSection = found.find((section) => section.key === "ingredients");
  const cookLogSection = found.find((section) => section.key === "cook log");
  const recipeLines = [];
  const inconsistencies = [];

  if (ingredientsSection) {
    let headerIndex = -1;
    for (let index = ingredientsSection.start; index < ingredientsSection.end - 1; index += 1) {
      const header = parseTableRow(lines[index]);
      const separator = parseTableRow(lines[index + 1]);
      if (header && separator && isSeparator(separator)) {
        headerIndex = index;
        break;
      }
    }

    if (headerIndex >= 0) {
      const headers = parseTableRow(lines[headerIndex]).map(normalise);
      const ingredientIndex = fieldIndex(headers, ["ingredient", "item", "name"]);
      const amountIndex = fieldIndex(headers, ["amount", "quantity", "qty"]);
      const unitIndex = fieldIndex(headers, ["unit", "measure"]);
      const noteIndex = fieldIndex(headers, ["note", "notes", "comment"]);

      for (let index = headerIndex + 2; index < ingredientsSection.end; index += 1) {
        const row = parseTableRow(lines[index]);
        if (!row) break;
        const rawName = clean(row[ingredientIndex >= 0 ? ingredientIndex : 0] ?? "");
        if (!rawName) continue;
        const quantity = parseQuantity(row[amountIndex], row[unitIndex]);
        const note = clean(row[noteIndex] ?? "") || null;
        const resolution = resolveIngredient(rawName, registry);
        const line = {
          rawName,
          ingredientId: resolution.ingredient?.id ?? null,
          ingredientName: resolution.ingredient?.name ?? null,
          amount: quantity.amount,
          unit: quantity.unit,
          note,
        };
        const lineNumber = recipeLines.length;
        recipeLines.push(line);

        if (!resolution.ingredient) {
          inconsistencies.push({ line: lineNumber, rawName, reason: "unresolved_ingredient", candidates: resolution.candidates });
        } else if (quantity.invalidAmount) {
          inconsistencies.push({ line: lineNumber, rawName, reason: "invalid_amount", candidates: [] });
        } else if (quantity.amount === null && !resolution.ingredient.isHandDepleted) {
          inconsistencies.push({ line: lineNumber, rawName, reason: "unmeasured_on_auto_depleted", candidates: [] });
        } else if (quantity.amount !== null && quantity.unit === null) {
          inconsistencies.push({ line: lineNumber, rawName, reason: "missing_unit", candidates: [] });
        } else if (quantity.amount !== null && !sameUnit(quantity.unit, resolution.ingredient.stockUnit)
          && !(resolution.ingredient.conversions ?? []).some((conversion) => sameUnit(conversion.fromUnit, quantity.unit))) {
          inconsistencies.push({ line: lineNumber, rawName, reason: "non_convertible_unit", candidates: [] });
        }
      }
    }
  }

  const readableSections = found
    .filter((section) => ["equipment", "steps", "serve with"].includes(section.key))
    .map((section) => `${section.name}\n${lines.slice(section.start, section.end).join("\n").trim()}`.trim())
    .filter(Boolean);

  const scaleable = typeof values.scaleable === "string" ? normalise(values.scaleable) : "no";
  const multiplierMatch = scaleable.match(/^(\d+)\s*x$/);
  const tags = Array.isArray(values.tags)
    ? values.tags
    : typeof values.tags === "string" ? values.tags.split(",").map(clean).filter(Boolean) : [];

  return {
    recipe: {
      name: recipeName(values, body),
      tags,
      servings: Number(values.servings ?? 1) || 1,
      maxMultiplier: multiplierMatch ? Number(multiplierMatch[1]) : 1,
      rating: rating(values.rating),
      prepMinutes: minutes(values["prep time"] ?? values.prep ?? values["prep minutes"]),
      cookMinutes: minutes(values["cook time"] ?? values.cook ?? values["cook minutes"]),
      source: typeof values.source === "string" ? values.source : null,
      steps: readableSections.join("\n\n") || null,
      lines: recipeLines,
      cookLog: parseCookLog(cookLogSection, lines),
    },
    inconsistencies,
  };
}
