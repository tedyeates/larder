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

## Workflow

1. `get_week_plan` — what is already planned. Do not overwrite meals the user wants.
2. `list_pantry` — what is available, including amounts and status.
3. `expiring_soon` — the items with the strongest claim on this week's menu.
4. `list_leftovers` — free meals already cooked. Slot these before cooking again.
5. `search_recipes` / `get_recipe` — prefer the library; only propose a new dish
   when nothing fits.
6. Propose the week in conversation. Be explicit about portions and about which
   expiring items each meal consumes.
7. Submit it with `create_meal_plan`. It lands as a **draft**; tell the human to
   activate or discard it in the Plan tab. Never claim it is live.
8. `propose_shopping_list` — show what still needs buying. It writes nothing; the
   human adds items in the app.

Planned leftovers are allowed: `kind: "leftover"` with a `recipe_id` and no batch
is an intent to eat something you have not cooked yet. It deducts nothing.

## Good output

- A day-by-day list, lunch and dinner, with portions.
- One line per meal naming the expiring ingredients it uses.
- A short shopping list, grouped by what the plan actually needs.
- Any ingredient whose unit blocked arithmetic, called out plainly.
