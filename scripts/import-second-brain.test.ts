import { describe, expect, it, vi } from "vitest";
import {
  buildImportPlan,
  parseCookLog,
  parsePreferences,
  parseShopConfig,
  parseTagVocabulary,
  parseTickTickCsv,
  parseUnits,
  printPlan,
} from "./import-second-brain.mjs";

const unitsMarkdown = `
# Units

| Category | Ingredient | Stock Unit |
| --- | --- | --- |
| Produce | Carrots | pieces |
| Produce | Garlic | cloves |
| Noodles | Egg noodles | g |
| Oils | Olive oil | bottle |
| Sauces | Soy sauce | bottle |

## Defaults

| Category | Stock Unit |
| --- | --- |
| Fruit & Veg | pieces |
| Household | pieces |

## Conversion notes

- 1 nest egg noodles ≈ 60g
- 1 garlic bulb ≈ 10 cloves
`;

describe("Second Brain deterministic importer parsers", () => {
  it("parses ingredient units, category defaults, Hand-Depleted categories and conversions", () => {
    expect(parseUnits(unitsMarkdown)).toEqual({
      ingredients: [
        { name: "Carrots", stockUnit: "pieces", isHandDepleted: false },
        { name: "Garlic", stockUnit: "cloves", isHandDepleted: false },
        { name: "Egg noodles", stockUnit: "g", isHandDepleted: false },
        { name: "Olive oil", stockUnit: "bottle", isHandDepleted: true },
        { name: "Soy sauce", stockUnit: "bottle", isHandDepleted: true },
      ],
      defaults: {
        "fruit & veg": "pieces",
        household: "pieces",
      },
      conversions: [
        { ingredientName: "Egg noodles", fromUnit: "nest", factorToStockUnit: 60 },
        { ingredientName: "Garlic", fromUnit: "bulb", factorToStockUnit: 10 },
      ],
    });
  });

  it("parses ordered emoji aisles and item Placement tables", () => {
    const shop = parseShopConfig("Lidl", `
# Lidl

## 🥬 Fruit & Veg

| Ingredient |
| --- |
| Carrots |
| Garlic |

## 🍜 Dry goods

| Ingredient | Aisle |
| --- | --- |
| Egg noodles | Dry goods |
| Soy sauce | Dry goods |
`);

    expect(shop).toEqual({
      name: "Lidl",
      aisles: [
        { name: "Fruit & Veg", emoji: "🥬", position: 0 },
        { name: "Dry goods", emoji: "🍜", position: 1 },
      ],
      placements: [
        { ingredientName: "Carrots", aisleName: "Fruit & Veg" },
        { ingredientName: "Garlic", aisleName: "Fruit & Veg" },
        { ingredientName: "Egg noodles", aisleName: "Dry goods" },
        { ingredientName: "Soy sauce", aisleName: "Dry goods" },
      ],
    });
  });

  it("parses TickTick title quantities, staples, locations and original creation dates", () => {
    const csv = `title,column,createdTime\n"❄️ Carrots — 8 pieces",Fridge,2026-06-01T10:20:00.000Z\n"Olive oil — staple",Cupboard,2026-06-02T10:20:00.000Z\n"🧻 Kitchen towels — 2 rolls",Household,2026-06-03T10:20:00.000Z\n"💊 Painkillers — 1 packet",Medicine,2026-06-04T10:20:00.000Z\n`;

    expect(parseTickTickCsv(csv)).toEqual([
      {
        ingredientName: "Carrots",
        quantity: 8,
        stockUnit: "pieces",
        storageLocation: "fridge",
        acquiredOn: "2026-06-01",
        isHandDepleted: false,
      },
      {
        ingredientName: "Olive oil",
        storageLocation: "cupboard",
        acquiredOn: "2026-06-02",
        isHandDepleted: true,
      },
      {
        ingredientName: "Kitchen towels",
        quantity: 2,
        stockUnit: "rolls",
        storageLocation: "household",
        acquiredOn: "2026-06-03",
        isHandDepleted: false,
      },
      {
        ingredientName: "Painkillers",
        quantity: 1,
        stockUnit: "packet",
        storageLocation: "medicine",
        acquiredOn: "2026-06-04",
        isHandDepleted: false,
      },
    ]);
  });

  it("parses historical Cook Log entries only from its section, preserving date, multiplier and note", () => {
    expect(parseCookLog("🌮 Food/Recipes/Ramen.md", `
---
title: Weeknight ramen
---

# Weeknight ramen

## Cook Log
- 2026-06-08 | ×2 | "fed friends"
- 2026-06-10 | ×1

## Notes
- 2026-01-01 | ×9 | "not history"
`)).toEqual([
      {
        recipeName: "Weeknight ramen",
        occurredOn: "2026-06-08",
        multiplier: 2,
        note: "fed friends",
        sourceKey: "🌮 Food/Recipes/Ramen.md:9",
      },
      {
        recipeName: "Weeknight ramen",
        occurredOn: "2026-06-10",
        multiplier: 1,
        note: null,
        sourceKey: "🌮 Food/Recipes/Ramen.md:10",
      },
    ]);
  });

  it("parses tag vocabulary and preference rows from headings and bullets", () => {
    expect(parseTagVocabulary("# Tags\n\n## Cuisine\n- Japanese\n- Quick\n")).toEqual(["Japanese", "Quick"]);
    expect(parsePreferences("Restrictions", "# Restrictions\n\n## Diet\n- Lactose free\n- Avoid shellfish\n")).toEqual([
      { category: "Diet", body: "Lactose free" },
      { category: "Diet", body: "Avoid shellfish" },
    ]);
  });

  it("finds the header row beneath a TickTick export's metadata preamble", () => {
    const csv = `"Date: 2026-06-05+0000"\n"Version: 7.1"\n"Status: 0 Normal"\n"Folder Name","List Name","Title","Column","createdTime"\n"","Pantry","❄️ Carrots — 8 pieces","Fridge","2026-06-01T10:20:00.000Z"\n`;

    expect(parseTickTickCsv(csv)).toEqual([
      {
        ingredientName: "Carrots",
        quantity: 8,
        stockUnit: "pieces",
        storageLocation: "fridge",
        acquiredOn: "2026-06-01",
        isHandDepleted: false,
      },
    ]);
  });

  it("refuses a conversion note whose factor does not land in the Ingredient's Stock Unit", () => {
    expect(() => parseUnits(`
| Ingredient | Stock Unit |
| --- | --- |
| Chopped tomatoes | tins |

- 1 tin chopped tomatoes ≈ 400g
`)).toThrow(/stocked in tins/);
  });

  it("refuses a Placement whose Aisle has no emoji heading to create it from", () => {
    expect(() => buildImportPlan({
      units: parseUnits(unitsMarkdown),
      shops: [parseShopConfig("Lidl", "| Ingredient | Aisle |\n| --- | --- |\n| Carrots | Fruit & Veg |")],
      pantry: [],
      mealLogs: [],
      preferences: [],
      tags: [],
    })).toThrow(/no emoji heading/);
  });

  it("prints the dry run grouped by type and states that nothing was written", () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      lines.push(String(message));
    });
    try {
      printPlan(buildImportPlan({
        units: parseUnits(unitsMarkdown),
        shops: [parseShopConfig("Lidl", "## 🥬 Fruit & Veg\n\n| Ingredient |\n| --- |\n| Carrots |")],
        pantry: parseTickTickCsv("title,column,createdTime\n\"❄️ Carrots — 8 pieces\",Fridge,2026-06-01T10:20:00Z\n"),
        mealLogs: parseCookLog("Recipes/Ramen.md", "# Ramen\n## Cook Log\n- 2026-06-08 | ×2"),
        preferences: parsePreferences("Preferences", "# Preferences\n- Favour older stock"),
        tags: parseTagVocabulary("- Japanese"),
      }));
    } finally {
      log.mockRestore();
    }

    expect(lines[0]).toBe("Dry run — no database writes made.");
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining("Convertible Units (2)"),
      expect.stringContaining("Shops (1)"),
      expect.stringContaining("Placements (1)"),
      expect.stringContaining("Stock Lots (1)"),
      expect.stringContaining("Historical Meal Logs (1)"),
      expect.stringContaining("Preferences (1)"),
    ]));
  });

  it("merges source formats into one deterministic plan without dropping a second Shop Placement", () => {
    const plan = buildImportPlan({
      units: parseUnits(unitsMarkdown),
      shops: [
        parseShopConfig("Lidl", "## 🥬 Fruit & Veg\n\n| Ingredient |\n| --- |\n| Carrots |"),
        parseShopConfig("Tesco", "## 🥕 Produce\n\n| Ingredient |\n| --- |\n| Carrots |"),
      ],
      pantry: parseTickTickCsv("title,column,createdTime\n\"❄️ Carrots — 8 pieces\",Fridge,2026-06-01T10:20:00Z\n\"Olive oil — staple\",Cupboard,2026-06-02T10:20:00Z\n"),
      mealLogs: parseCookLog("Recipes/Ramen.md", "# Ramen\n## Cook Log\n- 2026-06-08 | ×2 | \"fed friends\""),
      preferences: parsePreferences("Preferences", "# Preferences\n- Favour older stock"),
      tags: parseTagVocabulary("- Japanese"),
    });

    expect(plan.ingredients).toEqual(expect.arrayContaining([
      { name: "Carrots", stockUnit: "pieces", isHandDepleted: false },
      { name: "Olive oil", stockUnit: "bottle", isHandDepleted: true },
    ]));
    expect(plan.placements).toEqual([
      { ingredientName: "Carrots", shopName: "Lidl", aisleName: "Fruit & Veg" },
      { ingredientName: "Carrots", shopName: "Tesco", aisleName: "Produce" },
    ]);
    expect(plan.lots).toEqual([{ ingredientName: "Carrots", quantity: 8, storageLocation: "fridge", acquiredOn: "2026-06-01" }]);
    expect(plan.mealLogs[0]).toMatchObject({ occurredOn: "2026-06-08", recipeName: "Ramen", multiplier: 2 });
    expect(plan.preferences).toEqual([{ category: "Preferences", body: "Favour older stock" }]);
    expect(plan.tags).toEqual(["Japanese"]);
  });
});
