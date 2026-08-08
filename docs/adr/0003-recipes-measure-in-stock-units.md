# Recipes measure in Stock Units, and unresolvable lines block planning

Every Recipe line references an Ingredient by ID and states its amount in that Ingredient's single
Stock Unit, or in a Convertible Unit with a known factor. `1 handful of beansprouts` is not
accepted; `20 g` with the note "≈ half a bag" is. The only exception is a Hand-Depleted Ingredient
like soy sauce, which may carry no quantity at all because you adjust it by eye.

Anything that blocks exact arithmetic — an unmatched ingredient name, a non-convertible unit, an
unmeasured quantity on an Auto-Depleted Ingredient — is recorded as an Inconsistency. The Recipe
still saves and reads fine, but it cannot enter a Meal Plan until every line resolves. Deterministic
processes never guess; they block and ask once.

This is the decision the rest of the system rests on: shopping list arithmetic, pantry depletion and
Cookable checks are all impossible if `Chicken`, `Chicken thighs` and `1 handful` can coexist as
data. The cost is real — around a hundred manual fixes when importing the existing 40 recipes, and
mild friction whenever the AI drafts a new one. The alternative, auto-creating ingredients on the
fly, pollutes the canonical table within weeks and can't be cleaned up afterwards because old plans
and logs point at the junk rows.
