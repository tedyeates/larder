import type { UnitCode } from "../../domain/units";

/**
 * Gram weights for catalogue ingredients that are not in the starter seed (or
 * were created before the seed defined them). Keys are ingredient slugs.
 *
 * These are deliberately conservative kitchen measures, not lab densities: one
 * cup of flour is 120 g, one tablespoon of olive oil is 15 g. They exist so a
 * recipe can say "1 cup" or "2 tbsp" against a pantry stocked in grams, and so
 * one volume weight can cover the rest of its family.
 */
export const KNOWN_GRAMS: Readonly<Record<string, Readonly<Partial<Record<UnitCode, number>>>>> = {
  // Herbs and spices measured by the spoon.
  "garam-masala": { tsp: 2.5, tbsp: 7.5, cup: 120 },
  turmeric: { tsp: 2.5, tbsp: 7.5, cup: 120 },
  "sesame-seeds": { tsp: 3, tbsp: 9, cup: 144 },
  cornflour: { tsp: 2.7, tbsp: 8, cup: 128 },
  "chia-seeds": { tsp: 3.5, tbsp: 10.5, cup: 168 },
  "ground-coriander": { tsp: 2, tbsp: 6, cup: 96 },
  "smoked-paprika": { tsp: 2.3, tbsp: 7, cup: 112 },
  "cayenne-pepper": { tsp: 1.8, tbsp: 5.4, cup: 86 },
  "white-pepper": { tsp: 2.4, tbsp: 7.2, cup: 115 },
  "garlic-powder": { tsp: 3.1, tbsp: 9.3, cup: 149 },
  "onion-powder": { tsp: 2.4, tbsp: 7.2, cup: 115 },
  "dried-basil": { tsp: 1, tbsp: 3, cup: 48 },
  "dried-fenugreek-leaves": { tsp: 1, tbsp: 3, cup: 48 },
  aonori: { tsp: 1, tbsp: 3, cup: 48 },

  // Rice, pulses and jarred things.
  "jasmine-rice": { cup: 185, tbsp: 11.6 },
  "black-olives": { tsp: 2.8, tbsp: 8.5, cup: 135 },
  "chinese-olives": { tsp: 2.8, tbsp: 8.5, cup: 135 },
  capers: { tsp: 2.5, tbsp: 7.5, cup: 120 },
  nagaimo: { cup: 130, tbsp: 8 },
  beansprouts: { cup: 50, tbsp: 3.1, tsp: 1 },
  "pickled-red-ginger": { cup: 160, tbsp: 10 },
  "soybean-paste": { cup: 280, tbsp: 17.5, tsp: 5.8 },
  "haricot-beans": { can: 400 },
  "frozen-peas": { cup: 145, tbsp: 9 },
  "frozen-chips": { cup: 150 },
  "frozen-berries": { cup: 140 },
  "frozen-spinach": { cup: 190, tbsp: 12 },
  spinach: { cup: 30 },
  "green-beans": { cup: 100 },
  "sugar-snap-peas": { cup: 100 },
  "beef-mince": { cup: 220 },
  "lamb-mince": { cup: 220 },
  "ground-chicken": { cup: 220 },
  "ground-meat": { cup: 220 },

  // Pieces and bunches.
  dill: { bunch: 9, tbsp: 3, tsp: 1, cup: 48 },
  rosemary: { bunch: 20, tbsp: 3, tsp: 1 },
  thyme: { bunch: 15, tbsp: 3, tsp: 1 },
  "thai-basil": { each: 20, handful: 20, cup: 20, tbsp: 1.25, tsp: 0.4 },
  "chicken-wings": { each: 90 },
  "anchovy-fillet": { each: 4 },
  "egg-noodles": { nest: 60 },
  "rice-paper": { sheet: 8 },
  "pak-choi": { each: 150, cup: 70 },
  radish: { each: 15 },
  "stock-cube": { each: 10 },
  "tea-bag": { each: 2 },
  "bay-leaf": { each: 0.2 },
  "firm-tofu": { block: 400 },
  "pork-belly": { slice: 30 },
  brie: { slice: 30 },
  feta: { cup: 150, tbsp: 9.4 },
  salsa: { cup: 240, tbsp: 15 },
  "dairy-free-yoghurt": { cup: 245, tbsp: 15 },
  "udon-noodles": { pack: 200 },
  katsuobushi: { cup: 20, tbsp: 1.3 },
  tenkasu: { cup: 50, tbsp: 3.1 },

  // Liquids: density is enough; the domain derives spoons and cups from it.
  "lemon-juice": { ml: 1.03 },
  "orange-juice": { ml: 1.04 },
  "oat-milk": { ml: 1.03 },
  "maple-syrup": { ml: 1.33 },
  mayonnaise: { ml: 0.95 },
  ketchup: { ml: 1.1 },
  "sweet-chilli-sauce": { ml: 1.2 },
  "hoisin-sauce": { ml: 1.2 },
  "oyster-sauce": { ml: 1.2 },
  "teriyaki-sauce": { ml: 1.2 },
  "worcestershire-sauce": { ml: 1.1 },
  "vanilla-extract": { ml: 0.88 },
  "fish-sauce": { ml: 1.2 },
  "dark-soy-sauce": { ml: 1.2 },
  mirin: { ml: 1.2 },
  "rice-wine": { ml: 0.99 },
  "rice-wine-vinegar": { ml: 1.01 },
  dashi: { ml: 1.0 },
  "tomato-passata": { ml: 1.05 },
  "garlic-oil": { ml: 0.92 },
  gochujang: { ml: 1.25 },
  "miso-paste": { ml: 1.15 },
  "red-curry-paste": { ml: 1 },
  "mushroom-powder": { ml: 0.45 },
  "chicken-powder": { ml: 0.5 },
};
