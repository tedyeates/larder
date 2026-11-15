"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { ingredients, stockEntries } from "@/db/schema";
import { addDays, todayIso } from "@/domain/dates";
import { planDeduction, type StockEntry } from "@/domain/ledger";
import { assertUnitCode, formatQuantity, toBase, type UnitCode } from "@/domain/units";
import { auth } from "@/lib/auth/server";
import { getOrCreateAppUser } from "@/lib/users";

const adjustInput = z.object({
  ingredientId: z.uuid(),
  amount: z.coerce.number().positive().max(1_000_000),
  unit: z.string().min(1).max(16),
  mode: z.enum(["add", "use", "discard"]),
  bestBefore: z.string().optional(),
  note: z.string().max(200).optional(),
});

export interface AdjustResult {
  readonly error?: string;
  readonly message?: string;
}

/**
 * Add stock, use it up, or discard it. All three are ledger entries:
 * additions are purchase lots, usage is FEFO against the oldest lots, and
 * nothing is ever mutated in place.
 */
export async function adjustStock(formData: FormData): Promise<AdjustResult> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return { error: "You are signed out." };

  const parsed = adjustInput.safeParse({
    ingredientId: formData.get("ingredientId"),
    amount: formData.get("amount"),
    unit: formData.get("unit"),
    mode: formData.get("mode"),
    bestBefore: formData.get("bestBefore") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: "Check the amount and the unit." };

  const appUser = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const db = getDb();

  const [ingredient] = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.id, parsed.data.ingredientId), eq(ingredients.userId, appUser.id)))
    .limit(1);
  if (!ingredient) return { error: "That ingredient isn't in your catalogue." };

  const units = {
    id: ingredient.id,
    name: ingredient.name,
    stockUnit: ingredient.stockUnit as UnitCode,
    gramsPer: ingredient.gramsPer ?? undefined,
  };

  let amountInBase: number;
  try {
    amountInBase = toBase(parsed.data.amount, assertUnitCode(parsed.data.unit), units);
  } catch {
    return { error: `${parsed.data.unit} can't be converted for ${ingredient.name}.` };
  }
  if (amountInBase <= 0) return { error: "The amount must be greater than zero." };

  const today = todayIso();

  if (parsed.data.mode === "add") {
    const bestBefore =
      parsed.data.bestBefore ??
      (ingredient.shelfLifeDays === null ? null : addDays(today, ingredient.shelfLifeDays));

    await db.insert(stockEntries).values({
      userId: appUser.id,
      ingredientId: ingredient.id,
      quantity: amountInBase,
      unitAsEntered: parsed.data.unit,
      quantityAsEntered: parsed.data.amount,
      reason: "purchase",
      acquiredAt: today,
      bestBefore,
      note: parsed.data.note,
    });

    revalidatePath("/pantry");
    return { message: `Added ${formatQuantity(amountInBase, units)} of ${ingredient.name}.` };
  }

  const lots = await db
    .select()
    .from(stockEntries)
    .where(and(eq(stockEntries.userId, appUser.id), eq(stockEntries.ingredientId, ingredient.id)));

  const entries: StockEntry[] = lots.map((lot) => ({
    id: lot.id,
    ingredientId: lot.ingredientId,
    quantity: lot.quantity,
    acquiredAt: lot.acquiredAt,
    bestBefore: lot.bestBefore,
    reason: lot.reason,
  }));

  const deduction = planDeduction(entries, amountInBase);
  if (deduction.deducted <= 0) {
    return {
      error: `There's no ${ingredient.name} in stock to ${parsed.data.mode === "discard" ? "discard" : "use"}.`,
    };
  }

  await db.transaction(async (tx) => {
    for (const consumption of deduction.consumptions) {
      await tx.insert(stockEntries).values({
        userId: appUser.id,
        ingredientId: ingredient.id,
        quantity: -consumption.amount,
        unitAsEntered: parsed.data.unit,
        quantityAsEntered: -parsed.data.amount,
        reason: parsed.data.mode === "discard" ? "discard" : "adjust",
        acquiredAt: today,
        note: parsed.data.note,
      });
    }
  });

  revalidatePath("/pantry");

  if (deduction.shortfall > 0) {
    return {
      message: `Only had ${formatQuantity(deduction.deducted, units)}. The pantry is now empty.`,
    };
  }
  return { message: `Removed ${formatQuantity(deduction.deducted, units)} of ${ingredient.name}.` };
}
