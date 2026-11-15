import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ingredients, stockEntries } from "@/db/schema";
import { todayIso } from "@/domain/dates";
import type { StockEntry } from "@/domain/ledger";
import { pantryStatus, statusLabel, statusRank } from "@/domain/status";
import { formatQuantity, type UnitCode } from "@/domain/units";

export type PantryStatusLabel = "Out" | "Use soon" | "Low" | "OK";

export interface PantryRow {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  /** Base units, for sorting. */
  readonly onHand: number;
  /** Human string, e.g. "1.2 kg". */
  readonly display: string;
  /** The ingredient's stock unit, so the adjust sheet can offer sensible units. */
  readonly stockUnit: UnitCode;
  readonly earliestBestBefore: string | null;
  readonly useBy: string | null;
  readonly daysUntilExpiry: number | null;
  readonly status: PantryStatusLabel;
  readonly rank: number;
  readonly low: boolean;
  readonly useSoon: boolean;
  readonly expired: boolean;
}

/**
 * One row per ingredient. Quantities come from the ledger; dates come from the
 * lots that still hold stock. Nothing is cached in a column.
 */
export async function getPantryRows(
  userId: string,
  today: string = todayIso(),
): Promise<PantryRow[]> {
  const db = getDb();

  const [catalogue, entries] = await Promise.all([
    db
      .select()
      .from(ingredients)
      .where(eq(ingredients.userId, userId))
      .orderBy(asc(ingredients.name)),
    db.select().from(stockEntries).where(eq(stockEntries.userId, userId)),
  ]);

  const byIngredient = new Map<string, StockEntry[]>();
  for (const entry of entries) {
    const list = byIngredient.get(entry.ingredientId) ?? [];
    list.push({
      id: entry.id,
      ingredientId: entry.ingredientId,
      quantity: entry.quantity,
      acquiredAt: entry.acquiredAt,
      bestBefore: entry.bestBefore,
      reason: entry.reason,
    });
    byIngredient.set(entry.ingredientId, list);
  }

  const rows = catalogue.map<PantryRow>((item) => {
    const lots = byIngredient.get(item.id) ?? [];
    const status = pantryStatus({
      entries: lots,
      today,
      minStock: item.minStock,
    });

    // Anchored to UTC so a date never shifts by a day on the server.
    const useBy =
      status.earliestBestBefore === null
        ? null
        : new Date(`${status.earliestBestBefore}T00:00:00Z`).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          });

    return {
      id: item.id,
      name: item.name,
      category: item.category,
      onHand: status.onHand,
      display: formatQuantity(status.onHand, {
        id: item.id,
        name: item.name,
        stockUnit: item.stockUnit as UnitCode,
        gramsPer: item.gramsPer ?? undefined,
      }),
      stockUnit: item.stockUnit as UnitCode,
      earliestBestBefore: status.earliestBestBefore,
      useBy,
      daysUntilExpiry: status.daysUntilExpiry,
      status: statusLabel(status),
      rank: statusRank(status),
      low: status.low,
      useSoon: status.useSoon,
      expired: status.expired,
    };
  });

  return rows.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const aDays = a.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
    const bDays = b.daysUntilExpiry ?? Number.POSITIVE_INFINITY;
    if (aDays !== bDays) return aDays - bDays;
    return a.name.localeCompare(b.name);
  });
}
