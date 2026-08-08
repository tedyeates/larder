# Pantry

A meal planning and kitchen inventory app. AI proposes meal plans; everything downstream of
your approval is deterministic. The Meal Plan is a guide — the Pantry is reality.

## Language

### Recipes & Ingredients

**Recipe**: A set of instructions producing a known number of Portions from a list of Ingredients.
_Avoid_: Dish, meal (a Recipe is the instructions, not the food)

**Ingredient**: A canonical, uniquely-named thing a Recipe consumes and the Pantry stocks. Has
exactly one Stock Unit. Referenced by ID, never by name.
_Avoid_: Item, product

**Alias**: An alternate spelling or wording that resolves to one Ingredient. "Leak" and
"Chicken" are Aliases; "Leek" and "Chicken thighs" are Ingredients.
_Avoid_: Synonym, alternate name

**Stock Unit**: The single unit an Ingredient is counted in, in both the Pantry and every Recipe
that uses it (pieces, g, cloves, bottles). One per Ingredient, never varies.
_Avoid_: Unit, measure, pantry unit, default unit

**Convertible Unit**: A standard unit with a known factor to an Ingredient's Stock Unit, so a
Recipe may state it and the app can still deplete exactly (`1 cup flour = 120 g`).
_Avoid_: Alternate unit, cooking unit

**Auto-Depleted**: An Ingredient the app subtracts by itself when you Cook. Its Recipe
quantities must be in its Stock Unit or a Convertible Unit.
_Avoid_: Tracked, counted

**Hand-Depleted**: An Ingredient you adjust yourself because measuring it isn't worth it — soy
sauce, oils, salt. Stocked as a fraction of a container (`0.5 bottle`) and never touched by a
Cook. Recipes may name it with no quantity at all.
_Avoid_: Staple, untracked, manual

**Unmeasured Quantity**: A Recipe line with no arithmetic value — "splash", "to taste", "—".
Legal only for Hand-Depleted Ingredients.
_Avoid_: Vague quantity, staple amount

**Substitute**: An alternative Ingredient listed as acceptable for one Recipe line. Scoped to
that Recipe — rice wine may stand in for mirin in a stir-fry and not in sushi.
_Avoid_: Alternative, swap, equivalent

**Essential**: A Recipe line that accepts no Substitute, because the dish doesn't survive
without it.
_Avoid_: Required, mandatory, core

**Fulfilled by Substitute**: A Recipe line whose named Ingredient is out of stock but which a
listed Substitute in the Pantry can cover. Shown as a note, not a blocker.
_Avoid_: Substituted, partial match

**Cookable**: A Recipe every line of which is covered by the Pantry, directly or by Substitute.
Shown on the Meal Plan so you can see which meals reality allows.
_Avoid_: Available, makeable, ready

**Unresolved Ingredient**: An ingredient name on a Recipe that has not yet been matched to an
Ingredient. Blocks the Recipe from entering a Meal Plan until mapped.
_Avoid_: Unknown ingredient, orphan

**Inconsistency**: Anything in an imported or AI-written Recipe that blocks exact arithmetic — an
Unresolved Ingredient, a non-convertible unit ("handful"), or an Unmeasured Quantity on an
Auto-Depleted Ingredient. Surfaced for you to fix or send back to the AI.
_Avoid_: Error, warning, problem

### Planning

**Meal Plan**: The continuous, rolling schedule of intended meals. A guide, not an execution — a
confirmed Plan Proposal writes to the Shopping List once and never again. Slots in the past are
frozen; what actually happened lives in the Meal Log.
_Avoid_: Schedule, menu, calendar, week

**Planning Horizon**: The date the AI plans up to, counted from today. Usually a week out.
_Avoid_: Range, period, week

**Meal Slot**: One eating occasion in a Meal Plan — a date plus Breakfast, Lunch or Dinner. Holds
what you intend to eat, and is marked as the Cook occasion when the food gets made there.
_Avoid_: Meal time, entry, cell

**Cook**: A recorded act of making a Recipe at a multiplier, started from a Meal Slot or straight
from the Recipe. Consumes Stock Lots and produces one Portion Batch of `servings × multiplier`
Portions — no yield prompt, since both the Recipe's servings and the multiplier are yours to edit.
_Avoid_: Cook session, batch, prep

**Portion**: One serving's worth of food produced by a Cook. The unit in which cooked food is
counted.
_Avoid_: Serving (that's the Recipe's yield figure), leftover, meal

**Plan Proposal**: What the AI submits for review — proposed Meal Slots from today to the Planning
Horizon, plus any new Recipes, new Ingredients and suggested Aliases it needs. Reviewed and
confirmed or rejected as one unit. Replaces the future slots it covers; keeps any you asked it to
keep.
_Avoid_: Draft plan, suggestion, bundle

**Plan Check**: A structural rule a Plan Proposal must pass before it reaches you — portions match
slots, multiplier within the Recipe's limit, every Ingredient resolved, no silent gaps. Failures
go straight back to the AI to fix.
_Avoid_: Validation, rule, constraint

**Preference**: A stated leaning the AI reasons with — no repeats within four weeks, max three
cooks a week, lactose free, favour older stock. Never enforced by the app; you reject a plan that
ignores one by saying so.
_Avoid_: Rule, restriction, setting, constraint

**Allergen Flag**: A warning shown on a Recipe or Meal Plan when it contains something you avoid,
so you can catch it yourself. Informational — the app does not block it.
_Avoid_: Restriction, alert, warning

**Agent Runner**: The swappable container that hosts the planning AI. Reachable at a configurable
URL, takes a message and streams a reply, and submits Plan Proposals through the app's MCP.
_Avoid_: AI, agent, worker, kiro

**Agent Token**: The revocable secret an Agent Runner uses to call the app's API on your behalf.
Never grants direct database access.
_Avoid_: API key, service key

### Lifecycle

**Draft**: Written by the AI, not yet confirmed by you. Hidden from the rest of the app and
invisible to deterministic processes.
_Avoid_: Proposed, pending, unreviewed

**Confirmed**: Approved by you. Only Confirmed records take part in shopping list generation,
Pantry depletion or any other deterministic process.
_Avoid_: Reviewed, accepted, published

### Inventory

**Pantry**: The Ingredients you actually have, held as Stock Lots. System of record for what
you can cook with.
_Avoid_: Inventory, stock, storage

**Stock Lot**: A quantity of one Ingredient acquired on one date, in one Storage Location. Buying
more of it the same day adds to that day's Lot; buying it on another day makes a new one, so the
app can tell you the chicken is 7 days old. Consumed oldest-first.
_Avoid_: Stock item, batch, entry

**Meal Stock**: The Portions you actually have, held as Portion Batches. Separate from the
Pantry — a Portion cannot be an Ingredient in a Recipe — but shown alongside it.
_Avoid_: Meals, leftovers, freezer

**Portion Batch**: The Portions produced by one Cook — recipe, count remaining, date, Storage
Location. Lands in the Fridge by default, and merges with another Batch of the same Recipe cooked
the same day. A bought ready meal is a Portion Batch with no Recipe. Consumed oldest-first, and
editable by hand like everything else.
_Avoid_: Leftover, batch, meal

**Meal Log**: The record of what you actually ate — a Portion consumed, or an Ate Out. The source
of truth for variety and repetition when planning; never the Meal Plan.
_Avoid_: Feedback, history, diary, cook log

**Ate Out**: A Meal Log entry that consumed no Portion and depleted no Pantry — a restaurant, a
takeaway, someone else's cooking. Recorded as the fact only.
_Avoid_: Eating out, external meal, skip

**Shortfall**: A Meal Slot whose Portion will not exist, given what has actually been cooked and
eaten. Surfaced on the Meal Plan so you can see the guide has drifted from reality.
_Avoid_: Drift, conflict, missing meal

**Storage Location**: Where a stocked thing physically sits (Fridge, Freezer, Cupboard,
Counter, Household, Medicine).
_Avoid_: Category, column, section

**Shopping List**: The single set of Ingredients to buy. Written to once when a Meal Plan is
confirmed, and by you at any time. Nothing recalculates it — lines persist across trips until
bought or dismissed.
_Avoid_: Buy list, groceries

**Shopping Item**: One line on the Shopping List — an Ingredient and a Required Amount. One line
per Ingredient: adding something already listed raises its Required Amount rather than making a
second line. Appears in every Shop that has a Placement for it; buying it in one Shop removes it
from all of them. Buying creates or grows a Stock Lot, dismissing removes the line without stocking
anything.
_Avoid_: Task, entry, product

**Shop**: A place you buy from. A view over the Shopping List, showing only the Items it has
Placements for, sectioned by Aisle.
_Avoid_: Store, supermarket

**Aisle**: A named, emoji-carrying section of one Shop, ordered to match your walking route.
Sections the Shopping List rather than merely sorting it.
_Avoid_: Category, department, section

**Placement**: The Aisle an Ingredient sits in at a given Shop. `Udon noodles` has a Placement in
Lidl's Dry Goods and another in the Asian Supermarket's Noodles & Rice.
_Avoid_: Routing, location, mapping

**Unsorted**: Shopping Items with no Placement in any Shop. Shown in every Shop's list so you can
buy them wherever you are, with a prompt to give them an Aisle.
_Avoid_: Unknown aisle, uncategorised

**Required Amount**: How much of an Ingredient was needed beyond the Pantry at the moment a Meal
Plan was confirmed, or the amount you entered by hand. Calculated once, never revised.
_Avoid_: Needed amount, quantity

**Top-Up**: Deliberately adding a Recipe's missing Ingredients to the Shopping List, after the
Pantry has drifted from what the plan assumed. Always your action, never automatic.
_Avoid_: Restock, re-derive, sync

**Suggested Amount**: The amount you last actually bought of this Ingredient, since shops sell
packs. The default amount banked when you buy the Item, with the Required Amount available as an
alternative.
_Avoid_: Pack size, default amount
