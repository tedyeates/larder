# Research: Getting real recipes from the web (that can deplete a pantry)

Date: 2026-08-11
Issue: [#34](https://github.com/tedyeates/larder/issues/34) (map #25)
Question: How does the app obtain real recipes from the web such that ingredient lines
are structured enough to **deplete a pantry** — a quantity + unit resolvable to a
countable stock unit (`formats/units.md`: pieces, g, cloves, nests, cans, bottles…)?

## The hard requirement, restated

The v1 parser (`feature/prd-1:scripts/recipe-parser.mjs`) already sets the bar: it resolves
each ingredient name against a registry (exact / alias / fuzzy-suggestion), parses the amount
to a number, keeps the unit text, and converts to the stock unit via `unit_conversions`. Any
line it cannot resolve becomes an **Inconsistency** — flagged, never silently subtracted. So
the real question per source is not "does it give ingredients" but **"does it give a numeric
amount + a unit I can map to a stock unit, and if not, is the failure visible?"**

## 1. schema.org/Recipe JSON-LD scraping

- `recipeIngredient` is defined as: *"An ingredient or ordered list of ingredients and
  potentially quantities… e.g. 1 cup of sugar, flour or garlic. The ingredients can be
  represented as **free text** or more structured values."* So the spec **does not require**
  structured quantity/unit — free text is compliant and is what sites emit in practice.
  Source: https://schema.org/recipeIngredient (accessed 2026-08-11).
- Coverage is high: JSON-LD is Google's recommended format and the entry ticket for Recipe
  rich results, so most SEO-driven recipe sites embed a `<script type="application/ld+json">`
  Recipe block. The de-facto parser `recipe-scrapers` (Python, 7k★) supports JSON-LD +
  Microdata + RDFa + OpenGraph across hundreds of sites.
  Sources: https://github.com/hhursev/recipe-scrapers , https://docs.recipe-scrapers.com/ (accessed 2026-08-11).
- **Reliability of the ingredient strings is the problem.** `recipeIngredient` almost always
  returns bare strings like `"3/4 cup sugar"`; a structured `PropertyValue` (volume/unit/ingredient)
  form is *allowed* but so rare the library has an open issue noting it isn't even parsed.
  Source: https://git.durrantlab.pitt.edu/hhursev/recipe-scrapers/issues/1848 (accessed 2026-08-11).
- Real UK page checked — BBC Good Food, *Easy chow mein for kids* (Immediate Media):
  ingredient lines are `"thumb-size piece fresh root ginger"`, `"2 garlic cloves"`,
  `"3 tbsp tomato ketchup"`, `"half a 400g bag beansprouts"`, `"1 large or 2 small chicken
  breasts"`, `"3 nests medium egg noodles"`. These map *exactly* onto our stock units (ginger=knob,
  garlic=cloves, noodles=nests, beansprouts=g) — but half are un-parseable numbers
  ("thumb-size", "half a 400g bag", "1 large or 2 small").
  Source: https://www.bbcgoodfood.com/recipes/chicken-chow-mein (accessed 2026-08-11).

**Depletion verdict:** free text → needs an ingredient-line NLP parser (number + unit + name).
Works for `"200g chicken"`, fails on the vague lines above. **Only meets the requirement when
paired with a parser AND the existing flag-on-failure gate.**

## 2. Public recipe APIs

| API | Free tier | Ingredient quantities | Licensing / storage |
|-----|-----------|-----------------------|---------------------|
| **TheMealDB** | Free, test key `1`; list capped at 100 items, single-ingredient filter; $10 lifetime supporter key for prod/multi-filter | `strIngredientN` + `strMeasureN` — **measure is free text** ("1 tbsp", "1 large", "200g") | ToS: *"You cannot use third-party content in the API unless you have the owner's permission."* Crowd-sourced, small DB. Attribution guidance in `/AGENTS.md`. |
| **Spoonacular** | 150 points/day (~50 calls); **credit card required**, points-based (1 pt/call + 0.01/result + surcharges) | `extendedIngredients`: **structured** `amount` (float) + `unit` + `name` + `original`; plus a dedicated `parseIngredients` endpoint | Paid at any real scale; ToS restricts long-term storage/redistribution. |
| **Edamam Recipe Search v2** | Developer tier free-with-limits | `ingredients[]`: **structured** `quantity` (float) + `measure` + **`weight` (grams)** + `food` + `foodCategory` | Web recipes; **no cooking instructions** (URL back only); *fair use with link back*; **caching restricted to Recipe ID + name** on Developer tier; attribution required. |

Sources: https://www.themealdb.com/api.php , https://themealdb.com/terms_of_use.php ,
https://apis.io/plans/spoonacular/spoonacular-plans-pricing/ , https://pypi.org/project/spoonacular/ ,
https://developer.edamam.com/edamam-docs-recipe-api , https://developer.edamam.com/meal-planner-api (all accessed 2026-08-11).

**Depletion verdict:**
- **Spoonacular** — structurally the best fit (amount+unit already split); but cost, mandatory
  card, and storage/ToS limits are heavy for a personal always-on pantry.
- **Edamam** — even better structurally (`weight` in grams is ideal for depletion), **but its
  Developer-tier caching ban means you may not persist the recipe to subtract against later** —
  which is precisely what a pantry needs. So despite the best data, it **fails the "store in a
  personal database" half of the requirement** on the free tier.
- **TheMealDB** — free and clean JSON, but `strMeasure` is free text (same parsing problem as
  scraping) and the catalogue is tiny.

## 3. AI writing recipes behind the approval gate

The AI can emit directly into the app's own format (`formats/recipe.md`), choosing quantities and
units that already match `formats/units.md` — so its output is **depletion-ready by construction**,
with no free-text parsing gap and no third-party licensing. This is already today's workflow: the
user authors in Obsidian with AI help, and the AI must ask before inventing. Risk is factual
accuracy/provenance, mitigated by the **human approval gate that already exists** and the planner
seam's draft-only constraint (project config).

**Depletion verdict:** always meets the requirement; lowest integration risk; already gated.

## 4. Legal position on storing scraped recipes

- **Ingredient lists are not copyrightable.** US Copyright Office / 37 CFR §202.1(d) and settled
  case law: *"Mere listings of ingredients as in recipes… are not subject to copyright
  protection."* The idea/expression dichotomy protects only the *creative expression* — headnote
  prose, photographs, substantial literary instruction — not the functional list or the process.
  Sources: https://corporate.findlaw.com/intellectual-property/copyright-form-letter-copyright-of-recipes.html ,
  https://www.law.cornell.edu/cfr/text/37/202.1 ,
  https://copyrightalliance.org/are-recipes-cookbooks-protected-by-copyright/ (accessed 2026-08-11).
- So storing **ingredient lines + amounts + a link back to the source** in a personal DB is
  low-risk. Copying the full creative method prose wholesale is the part that carries risk.
- Copyright is separate from **contract/access terms**: a site's ToS and `robots.txt` can still
  forbid scraping regardless of copyright. For personal, low-volume, user-initiated import respect
  `robots.txt`, identify a UA, rate-limit, and prefer storing the URL over the prose.

## Summary & recommended import path

No single external source both (a) gives structured quantities *and* (b) lets you store them for
later depletion for free. Rank by fit to *our* requirement:

1. **Primary — AI-authored into our own format, behind the existing approval gate.** Depletion-ready
   by construction, no licensing, already how the user works. Make this the default "get a recipe" path.
2. **Secondary — user-pasted URL → JSON-LD scrape (`recipe-scrapers`/equivalent) → ingredient-line
   parser → the SAME `recipe-parser.mjs` inconsistency gate.** Free, broad coverage, copyright-safe if
   we persist only ingredient lines + source URL (link back) and honour `robots.txt`/ToS. Vague lines
   ("thumb-size", "half a bag") are **flagged for human resolution, not silently broken** — exactly the
   v1 behaviour.
3. **Optional enrichment — Spoonacular `parseIngredients`** to turn a free-text line into amount+unit
   when our own parser can't, used sparingly within the 150/day free budget.
4. **Do not** build the pantry loop on **Edamam** (caching ban blocks persistence for depletion) or
   lean on **TheMealDB** (free text + tiny catalogue) as the structured backbone.

**Cannot meet the depletion requirement on their own:** JSON-LD scraping and TheMealDB (free-text
quantities — require a parser + flag gate); Edamam free tier (structured but may not be stored to
deplete against). **Can, structurally:** Spoonacular and Edamam data, and AI-authored recipes.

## Open questions

- How good is an off-the-shelf ingredient-line parser on UK phrasing ("nests", "knob", "bag")? Worth a
  spike measuring flag-rate on ~20 real BBC Good Food pages before committing to path 2.
- Confirm current Edamam free-tier caching wording against a signed developer agreement (docs summarise
  it as ID+name only) before ruling it in/out definitively.
