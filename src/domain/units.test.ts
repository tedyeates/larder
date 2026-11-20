import { describe, expect, it } from "vitest";
import {
  baseUnitFor,
  ConversionError,
  canConvert,
  convertBetweenIngredients,
  entryUnits,
  formatQuantity,
  fromBase,
  type IngredientUnits,
  parseUnit,
  roundAmount,
  toBase,
} from "./units";

const rice: IngredientUnits = { id: "rice", name: "Rice", stockUnit: "kg" };
const flour: IngredientUnits = {
  id: "flour",
  name: "Flour",
  stockUnit: "g",
  gramsPer: { cup: 120, tbsp: 8 },
};
const onion: IngredientUnits = {
  id: "onion",
  name: "Onion",
  stockUnit: "g",
  gramsPer: { each: 150 },
};
const egg: IngredientUnits = {
  id: "egg",
  name: "Egg",
  stockUnit: "each",
  gramsPer: { each: 50 },
};
const garlic: IngredientUnits = { id: "garlic", name: "Garlic", stockUnit: "clove" };
const milk: IngredientUnits = {
  id: "milk",
  name: "Milk",
  stockUnit: "ml",
  gramsPer: { ml: 1.03 },
};

describe("base units", () => {
  it("normalises mass to grams, volume to millilitres, count to itself", () => {
    expect(baseUnitFor("kg")).toBe("g");
    expect(baseUnitFor("cup")).toBe("ml");
    expect(baseUnitFor("clove")).toBe("clove");
  });
});

describe("toBase", () => {
  it("converts inside the mass family exactly", () => {
    expect(toBase(1.5, "kg", rice)).toBe(1500);
    expect(toBase(200, "g", rice)).toBe(200);
  });

  it("converts inside the volume family without hints", () => {
    expect(toBase(2, "tbsp", milk)).toBe(30);
    expect(toBase(0.5, "l", milk)).toBe(500);
  });

  it("keeps a count unit as its own base", () => {
    expect(toBase(3, "clove", garlic)).toBe(3);
  });

  it("crosses count into mass using the per-piece hint", () => {
    expect(toBase(2, "each", onion)).toBe(300);
  });

  it("crosses mass into count using the same hint in reverse", () => {
    expect(toBase(300, "g", egg)).toBe(6);
  });

  it("crosses volume into mass using cup weight", () => {
    expect(toBase(1, "cup", flour)).toBe(120);
    expect(toBase(2, "tbsp", flour)).toBe(16);
  });

  it("derives other volume measures from whichever weight it has", () => {
    const cupOnly: IngredientUnits = {
      id: "flour",
      name: "Flour",
      stockUnit: "g",
      gramsPer: { cup: 120 },
    };
    expect(toBase(1, "tbsp", cupOnly)).toBeCloseTo(7.5, 6);
    expect(toBase(1, "tsp", cupOnly)).toBeCloseTo(2.5, 6);
  });

  it("uses a volume weight as density for a volume-stocked ingredient", () => {
    const stockInMl: IngredientUnits = {
      id: "milk",
      name: "Milk",
      stockUnit: "ml",
      gramsPer: { cup: 240 },
    };
    expect(toBase(100, "g", stockInMl)).toBe(100);
  });

  it("crosses mass into volume using density", () => {
    expect(roundAmount(toBase(103, "g", milk))).toBe(100);
  });

  it("throws rather than guess when there is no hint", () => {
    const noHint: IngredientUnits = { id: "x", name: "Mystery", stockUnit: "g" };
    expect(() => toBase(1, "cup", noHint)).toThrow(ConversionError);
  });

  it("refuses to convert between differently-named count units", () => {
    const noHint: IngredientUnits = { id: "x", name: "Mystery", stockUnit: "clove" };
    expect(() => toBase(1, "each", noHint)).toThrow(ConversionError);
  });
});

describe("fromBase", () => {
  it("round-trips a conversion", () => {
    expect(fromBase(toBase(1.2, "kg", rice), "kg", rice)).toBeCloseTo(1.2, 6);
    expect(fromBase(toBase(3, "tbsp", milk), "tbsp", milk)).toBeCloseTo(3, 6);
  });

  it("reports convertibility without throwing", () => {
    expect(canConvert("cup", "g", flour)).toBe(true);
    expect(canConvert("cup", "g", rice)).toBe(false);
  });
});

describe("parseUnit", () => {
  it("accepts canonical codes and common recipe spellings", () => {
    expect(parseUnit("cup")).toBe("cup");
    expect(parseUnit("cups")).toBe("cup");
    expect(parseUnit("Tablespoons")).toBe("tbsp");
    expect(parseUnit("teaspoons")).toBe("tsp");
    expect(parseUnit("grams")).toBe("g");
    expect(parseUnit("fl. oz.")).toBe("floz");
    expect(parseUnit("tins")).toBe("can");
    expect(parseUnit("handfuls")).toBe("handful");
  });

  it("refuses a unit it does not know", () => {
    expect(parseUnit("splash")).toBeNull();
    expect(parseUnit("")).toBeNull();
  });
});

describe("entryUnits", () => {
  it("offers cups and spoons for a gram ingredient that has weights for them", () => {
    const units = entryUnits(flour);
    expect(units).toContain("g");
    expect(units).toContain("kg");
    expect(units).toContain("cup");
    expect(units).toContain("tbsp");
    expect(units).toContain("tsp");
  });

  it("offers grams when a volume ingredient has a density", () => {
    const units = entryUnits(milk);
    expect(units).toContain("ml");
    expect(units).toContain("cup");
    expect(units).toContain("g");
  });

  it("offers counted hints for a mass ingredient", () => {
    expect(entryUnits(onion)).toContain("each");
  });

  it("keeps an unhinted ingredient to its own family", () => {
    const mystery: IngredientUnits = { id: "x", name: "Mystery", stockUnit: "g" };
    expect(entryUnits(mystery)).toEqual(["g", "kg", "oz", "lb"]);
  });
});

describe("formatting", () => {
  it("prefers kg and l at a thousand base units", () => {
    expect(formatQuantity(1200, rice)).toBe("1.2 kg");
    expect(formatQuantity(250, rice)).toBe("250 g");
    expect(formatQuantity(1500, milk)).toBe("1.5 l");
  });

  it("pluralises counted things", () => {
    expect(formatQuantity(1, egg)).toBe("1 each");
    expect(formatQuantity(6, egg)).toBe("6 each");
    const loaf: IngredientUnits = { id: "b", name: "Bread", stockUnit: "each" };
    expect(formatQuantity(2, loaf)).toBe("2 each");
  });
});

describe("convertBetweenIngredients", () => {
  const bunches: IngredientUnits = {
    id: "spring",
    name: "Spring onion",
    stockUnit: "bunch",
    gramsPer: { bunch: 60 },
  };
  const each: IngredientUnits = {
    id: "spring",
    name: "Spring onion",
    stockUnit: "each",
    gramsPer: { bunch: 60, each: 10 },
  };

  it("leaves mass alone when only the display unit changes", () => {
    const from: IngredientUnits = { id: "rice", name: "Rice", stockUnit: "kg" };
    const to: IngredientUnits = { id: "rice", name: "Rice", stockUnit: "g" };
    expect(convertBetweenIngredients(1500, from, to)).toBe(1500);
  });

  it("converts counted units through grams", () => {
    expect(convertBetweenIngredients(2, bunches, each)).toBe(12);
  });

  it("refuses without a bridge", () => {
    const noEach: IngredientUnits = { ...each, gramsPer: { bunch: 60 } };
    expect(() => convertBetweenIngredients(2, bunches, noEach)).toThrow(ConversionError);
  });

  it("converts mass into count", () => {
    const onion: IngredientUnits = {
      id: "onion",
      name: "Onion",
      stockUnit: "each",
      gramsPer: { each: 150 },
    };
    const grams: IngredientUnits = { id: "onion", name: "Onion", stockUnit: "g" };
    expect(convertBetweenIngredients(300, grams, onion)).toBe(2);
  });

  it("uses a cup weight as density when swapping between grams and millilitres", () => {
    const grams: IngredientUnits = {
      id: "milk",
      name: "Milk",
      stockUnit: "g",
      gramsPer: { cup: 240 },
    };
    const millilitres: IngredientUnits = {
      id: "milk",
      name: "Milk",
      stockUnit: "ml",
      gramsPer: { cup: 240 },
    };
    expect(convertBetweenIngredients(240, grams, millilitres)).toBe(240);
  });
});

describe("roundAmount", () => {
  it("removes floating point dust", () => {
    expect(roundAmount(0.1 + 0.2)).toBe(0.3);
    expect(roundAmount(-0)).toBe(0);
  });
});
