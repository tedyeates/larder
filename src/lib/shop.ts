import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ingredients, shoppingItems, shoppingLists, stockEntries } from "@/db/schema";
import { addDays, todayIso } from "@/domain/dates";
import { assertUnitCode, isUnitCode, toBase, type UnitCode } from "@/domain/units";

export interface ShoppingRow {
  readonly id: string;
  readonly label: string;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly display: string;
  readonly status: "pending" | "ticked" | "removed";
  readonly origin: "generated" | "manual";
  readonly ingredientId: string | null;
  readonly quantityLocked: boolean;
  readonly ticktickTaskId: string | null;
  readonly ticktickProjectId: string | null;
  readonly ticktickTitle: string | null;
}

export async function getOpenList(userId: string): Promise<{ id: string; name: string }> {
  const db = getDb();
  const [existing] = await db
    .select({ id: shoppingLists.id, name: shoppingLists.name })
    .from(shoppingLists)
    .where(and(eq(shoppingLists.userId, userId), eq(shoppingLists.status, "open")))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(shoppingLists)
    .values({ userId, name: "Shopping" })
    .returning({ id: shoppingLists.id, name: shoppingLists.name });
  if (!created) throw new Error("Could not open a shopping list");
  return created;
}

export async function getShoppingRows(listId: string): Promise<ShoppingRow[]> {
  const rows = await getDb()
    .select({
      id: shoppingItems.id,
      label: shoppingItems.label,
      quantity: shoppingItems.quantity,
      unit: shoppingItems.unit,
      status: shoppingItems.status,
      origin: shoppingItems.origin,
      ingredientId: shoppingItems.ingredientId,
      quantityLocked: shoppingItems.quantityLocked,
      ticktickTaskId: shoppingItems.ticktickTaskId,
      ticktickProjectId: shoppingItems.ticktickProjectId,
      ticktickTitle: shoppingItems.ticktickTitle,
    })
    .from(shoppingItems)
    .where(eq(shoppingItems.listId, listId))
    .orderBy(asc(shoppingItems.sortOrder), asc(shoppingItems.label));

  return rows
    .filter((row) => row.status !== "removed")
    .map((row) => {
      const quantity = row.quantity ?? null;
      const unit = row.unit ?? null;
      return {
        ...row,
        display:
          quantity === null ? "" : `${Math.round(quantity * 1000) / 1000} ${unit ?? ""}`.trim(),
      };
    });
}

export function pendingCount(rows: readonly ShoppingRow[]): number {
  return rows.filter((row) => row.status === "pending").length;
}

export interface CompleteShoppingItemResult {
  readonly error?: string;
  readonly message?: string;
}

/**
 * Tick one shopping item and, when it is measured, put it into the pantry.
 * Shared by the Shop UI and the TickTick sync so both write the same ledger row.
 */
export async function completeShoppingItem(
  userId: string,
  itemId: string,
): Promise<CompleteShoppingItemResult> {
  const db = getDb();
  const [row] = await db
    .select({
      id: shoppingItems.id,
      ingredientId: shoppingItems.ingredientId,
      label: shoppingItems.label,
      quantity: shoppingItems.quantity,
      unit: shoppingItems.unit,
      status: shoppingItems.status,
    })
    .from(shoppingItems)
    .innerJoin(shoppingLists, eq(shoppingItems.listId, shoppingLists.id))
    .where(and(eq(shoppingItems.id, itemId), eq(shoppingLists.userId, userId)))
    .limit(1);

  if (!row) return { error: "That item is gone." };
  if (row.status !== "pending") return { message: "Already ticked." };

  if (
    row.ingredientId === null ||
    row.quantity === null ||
    row.unit === null ||
    !isUnitCode(row.unit)
  ) {
    await db
      .update(shoppingItems)
      .set({ status: "ticked", tickedAt: new Date() })
      .where(eq(shoppingItems.id, row.id));
    return { message: `${row.label} ticked.` };
  }

  const [item] = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.id, row.ingredientId), eq(ingredients.userId, userId)))
    .limit(1);
  if (!item) return { error: "That ingredient is gone." };

  let amount: number;
  try {
    amount = toBase(row.quantity, assertUnitCode(row.unit), {
      id: item.id,
      name: item.name,
      stockUnit: item.stockUnit as UnitCode,
      gramsPer: item.gramsPer ?? undefined,
    });
  } catch {
    return { error: `${row.label}: ${row.unit} can't be converted.` };
  }

  const today = todayIso();
  const bestBefore = item.shelfLifeDays === null ? null : addDays(today, item.shelfLifeDays);

  await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(stockEntries)
      .values({
        userId,
        ingredientId: item.id,
        quantity: amount,
        unitAsEntered: row.unit,
        quantityAsEntered: row.quantity,
        reason: "purchase",
        acquiredAt: today,
        bestBefore,
        shoppingItemId: row.id,
      })
      .returning({ id: stockEntries.id });

    await tx
      .update(shoppingItems)
      .set({ status: "ticked", tickedAt: new Date(), resultingStockEntryId: entry?.id })
      .where(eq(shoppingItems.id, row.id));
  });

  return { message: `${row.label} added to the pantry.` };
}
