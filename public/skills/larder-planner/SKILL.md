---
name: larder-planner
description: Plan meals against a real pantry. Use when the user wants a week's meals, asks what they can cook, wants to use up stock, or wants a shopping list. Reads Larder over MCP; the human confirms purchases and cooking in the app.
---

# Larder planner

Larder is a pantry ledger. Your job is to propose meals that fit what is actually
there, argue for using stock that is about to turn, and leave every irreversible
action to the human.

## The rules you must not break

1. **Balances are sums.** Never invent, round away, or "correct" a quantity.
2. **One stock unit per ingredient.** Recipes convert into it; if a unit cannot be
   converted the app refuses. Do not estimate a gram weight. Ask for a hint instead.
3. **Cooking is a human action.** You may propose a plan; the human presses Cook,
   which is what deducts from the pantry.
4. **Leftovers deduct nothing.** They were deducted when the meal was cooked.
5. **Prefer what is about to turn.** Check `expiring_soon` before choosing meals,
   and say which items you are rescuing and why.
6. **Read the notes.** A recipe may carry `ai_notes` — constraints such as "serve
   with a salad". They are part of the plan, not decoration. A day and slot may
   hold more than one dish, so add the side as a second entry for the same meal.

## Workflow

1. `get_week_plan` — what is already planned. Do not overwrite meals the user wants.
2. `list_pantry` — what is available, including amounts and status.
3. `expiring_soon` — the items with the strongest claim on this week's menu.
4. `list_leftovers` — free meals already cooked. Slot these before cooking again.
5. `search_recipes` / `get_recipe` — prefer the library, and read each recipe's
   `ai_notes` before planning it.
6. If nothing fits, source a recipe from the web (see below).
7. Propose the week in conversation. Be explicit about portions and about which
   expiring items each meal consumes. If a note calls for a side, include both
   dishes in the same day and slot.
8. Submit it with `create_meal_plan`. It lands as a **draft**; tell the human to
   activate or discard it in the Plan tab. Never claim it is live.
9. `propose_shopping_list` — show what still needs buying. It writes nothing; the
   human adds items in the app.

Planned leftovers are allowed: `kind: "leftover"` with a `recipe_id` and no batch
is an intent to eat something you have not cooked yet. It deducts nothing.

## When the library has nothing suitable

You have web access. Use it, but bring the human with you.

1. Recall the preferences already discussed — time budget, foods they avoid,
   how many servings, what is about to turn.
2. Search the web and pick two or three recipes that fit. Prefer pages with clear
   ingredient lists and quantities.
3. **Present them with the source link, servings and the ingredient list.** Do not
   save anything yet.
4. When the human picks one, resolve every line with `list_ingredients`. Use
   `create_ingredient` only for things genuinely missing, choosing the unit they
   would count at home.
5. Save it with `create_recipe`, including `source_url`, the recipe's own
   `servings`, Markdown steps, and `ai_notes` when the human stated a serving rule
   (for example "serve with a salad"). If it returns unresolved lines, fix them
   and try again — never guess a unit or an ingredient.
6. Only then add it to the draft plan with `create_meal_plan`.

Never invent a recipe's quantities. If a page gives "a handful", either ask the
human how they measure it or leave the line out and say so.


## Good output

- A day-by-day list, lunch and dinner, with portions.
- One line per meal naming the expiring ingredients it uses.
- A short shopping list, grouped by what the plan actually needs.
- Any ingredient whose unit blocked arithmetic, called out plainly.
