import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shoppingItems, shoppingLists } from "@/db/schema";

export interface ShoppingRow {
  readonly id: string;
  readonly label: string;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly display: string;
  readonly status: "pending" | "ticked" | "removed";
  readonly origin: "generated" | "manual";
  readonly ingredientId: string | null;
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
