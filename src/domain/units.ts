/**
 * Units and conversion.
 *
 * Every ingredient is stocked in exactly one unit. Amounts are normalised to that
 * unit's family base before they touch the ledger: grams for mass, millilitres for
 * volume, and the stock unit itself for counted things.
 *
 * Conversions inside a family are exact. Anything crossing a family (grams of
 * flour in a cup, grams of onion per onion) needs a hint from the ingredient.
 * Without one we throw — highlighting the impossible line is cheaper than
 * silently guessing.
 */

export type UnitFamily = "mass" | "volume" | "count";

interface UnitDef {
  readonly family: UnitFamily;
  /** Multiplier to the family base: grams, millilitres, or 1 for count units. */
  readonly toBase: number;
  readonly label: string;
  readonly plural: string;
}

export const UNITS = {
  // mass — base is grams
  g: { family: "mass", toBase: 1, label: "g", plural: "g" },
  kg: { family: "mass", toBase: 1_000, label: "kg", plural: "kg" },
  oz: { family: "mass", toBase: 28.349523125, label: "oz", plural: "oz" },
  lb: { family: "mass", toBase: 453.59237, label: "lb", plural: "lb" },

  // volume — base is millilitres
  ml: { family: "volume", toBase: 1, label: "ml", plural: "ml" },
  l: { family: "volume", toBase: 1_000, label: "l", plural: "l" },
  tsp: { family: "volume", toBase: 5, label: "tsp", plural: "tsp" },
  tbsp: { family: "volume", toBase: 15, label: "tbsp", plural: "tbsp" },
  cup: { family: "volume", toBase: 240, label: "cup", plural: "cups" },
  floz: { family: "volume", toBase: 29.5735295625, label: "fl oz", plural: "fl oz" },

  // count — no conversion between different count units without a hint
  each: { family: "count", toBase: 1, label: "each", plural: "each" },
  clove: { family: "count", toBase: 1, label: "clove", plural: "cloves" },
  slice: { family: "count", toBase: 1, label: "slice", plural: "slices" },
  rasher: { family: "count", toBase: 1, label: "rasher", plural: "rashers" },
  fillet: { family: "count", toBase: 1, label: "fillet", plural: "fillets" },
  head: { family: "count", toBase: 1, label: "head", plural: "heads" },
  bunch: { family: "count", toBase: 1, label: "bunch", plural: "bunches" },
  sprig: { family: "count", toBase: 1, label: "sprig", plural: "sprigs" },
  can: { family: "count", toBase: 1, label: "can", plural: "cans" },
  pack: { family: "count", toBase: 1, label: "pack", plural: "packs" },
} as const satisfies Record<string, UnitDef>;

export type UnitCode = keyof typeof UNITS;

export interface IngredientUnits {
  readonly id: string;
  readonly name: string;
  /** The single unit this ingredient is stocked in. */
  readonly stockUnit: UnitCode;
  /**
   * Grams per one of a given unit, for crossing families.
   * `{ each: 150 }` means one onion weighs 150 g.
   * `{ cup: 120, ml: 0.53 }` lets 100 g of flour resolve to millilitres.
   */
  readonly gramsPer?: Partial<Record<UnitCode, number>>;
}

export class ConversionError extends Error {
  constructor(
    readonly ingredient: IngredientUnits,
    readonly from: UnitCode,
    readonly to: UnitCode,
  ) {
    super(
      `Cannot convert ${from} to ${to} for ${ingredient.name}. ` +
        `Set a ${from}-per-${to} hint or correct the recipe unit.`,
    );
    this.name = "ConversionError";
  }
}

export function isUnitCode(value: string): value is UnitCode {
  return Object.hasOwn(UNITS, value);
}

export function assertUnitCode(value: string): UnitCode {
  if (!isUnitCode(value)) throw new Error(`Unknown unit: ${value}`);
  return value;
}

export function unitFamily(unit: UnitCode): UnitFamily {
  return UNITS[unit].family;
}

/** The unit amount is stored in: grams, millilitres, or the count unit itself. */
export function baseUnitFor(stockUnit: UnitCode): UnitCode {
  const family = unitFamily(stockUnit);
  if (family === "mass") return "g";
  if (family === "volume") return "ml";
  return stockUnit;
}

/** Strip floating-point dust without hiding a real fraction. */
export function roundAmount(amount: number): number {
  const rounded = Math.round(amount * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function gramsPerBase(ingredient: IngredientUnits): number | null {
  const base = baseUnitFor(ingredient.stockUnit);
  if (unitFamily(base) === "mass") return 1;
  const hint = ingredient.gramsPer?.[base];
  return hint !== undefined && hint > 0 ? hint : null;
}

function gramsOf(amount: number, unit: UnitCode, ingredient: IngredientUnits): number | null {
  if (unitFamily(unit) === "mass") return amount * UNITS[unit].toBase;
  const hint = ingredient.gramsPer?.[unit];
  return hint !== undefined && hint > 0 ? amount * hint : null;
}

/**
 * Convert an amount in `from` into the ingredient's stored base unit.
 * Throws ConversionError when the unit cannot be reconciled.
 */
export function toBase(amount: number, from: UnitCode, ingredient: IngredientUnits): number {
  const base = baseUnitFor(ingredient.stockUnit);
  if (from === base) return roundAmount(amount);

  const fromFamily = unitFamily(from);
  const baseFamily = unitFamily(base);

  // Same family (mass or volume): exact factor, no hints required.
  if (fromFamily === baseFamily && fromFamily !== "count") {
    return roundAmount((amount * UNITS[from].toBase) / UNITS[base].toBase);
  }

  // Cross a family, or cross between differently-named count units: go via grams.
  const grams = gramsOf(amount, from, ingredient);
  const perBase = gramsPerBase(ingredient);
  if (grams === null || perBase === null) throw new ConversionError(ingredient, from, base);
  return roundAmount(grams / perBase);
}

/** Convert an amount from the stored base unit into a display or recipe unit. */
export function fromBase(amount: number, to: UnitCode, ingredient: IngredientUnits): number {
  const base = baseUnitFor(ingredient.stockUnit);
  if (to === base) return roundAmount(amount);

  const toFamily = unitFamily(to);
  const baseFamily = unitFamily(base);

  if (toFamily === baseFamily && toFamily !== "count") {
    return roundAmount((amount * UNITS[base].toBase) / UNITS[to].toBase);
  }

  const perBase = gramsPerBase(ingredient);
  const gramsPerTo = gramsOf(1, to, ingredient);
  if (perBase === null || gramsPerTo === null) throw new ConversionError(ingredient, base, to);
  return roundAmount((amount * perBase) / gramsPerTo);
}

export function canConvert(from: UnitCode, to: UnitCode, ingredient: IngredientUnits): boolean {
  try {
    toBase(1, from, ingredient);
    fromBase(1, to, ingredient);
    return true;
  } catch {
    return false;
  }
}

function trim(amount: number): string {
  if (Math.abs(amount) >= 100) return String(Math.round(amount));
  return String(roundAmount(Number(amount.toFixed(2))));
}

/** The units a person would plausibly enter for this ingredient. */
export function siblingUnits(stockUnit: UnitCode): UnitCode[] {
  const family = unitFamily(baseUnitFor(stockUnit));
  if (family === "mass") return ["g", "kg"];
  if (family === "volume") return ["ml", "l"];
  return [stockUnit];
}

/** Render an amount stored in base units the way a person would say it. */
export function formatQuantity(amountInBase: number, ingredient: IngredientUnits): string {
  const base = baseUnitFor(ingredient.stockUnit);
  const family = unitFamily(base);

  if (family === "mass") {
    return Math.abs(amountInBase) >= 1_000
      ? `${trim(amountInBase / 1_000)} kg`
      : `${trim(amountInBase)} g`;
  }
  if (family === "volume") {
    return Math.abs(amountInBase) >= 1_000
      ? `${trim(amountInBase / 1_000)} l`
      : `${trim(amountInBase)} ml`;
  }

  const unit = UNITS[ingredient.stockUnit];
  const label = Math.abs(amountInBase) === 1 ? unit.label : unit.plural;
  return `${trim(amountInBase)} ${label}`;
}

/** Render an amount in an explicit unit, for "as entered" display. */
export function formatIn(amount: number, unit: UnitCode): string {
  const def = UNITS[unit];
  const label = Math.abs(amount) === 1 ? def.label : def.plural;
  return `${trim(amount)} ${label}`;
}
