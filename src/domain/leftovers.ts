/**
 * Portions and leftovers.
 *
 * A cook produces portions. Portions eaten now are gone; the rest become a
 * leftover batch with its own use-by date. Leftovers are meals in their own
 * right — slotting one into a plan deducts nothing, because the ingredients
 * already left the pantry at cook time.
 */

import { addDays } from "./dates";
import { roundAmount } from "./units";

/** Cooked food is good for three days unless you say otherwise. */
export const DEFAULT_LEFTOVER_DAYS = 3;

export interface CookSplit {
  readonly portionsCooked: number;
  readonly eatenNow: number;
  readonly leftoverPortions: number;
}

/** Clamp the "eaten now" stepper to the amount actually cooked. */
export function splitPortions(portionsCooked: number, eatenNow: number): CookSplit {
  const cooked = roundAmount(Math.max(0, portionsCooked));
  const eaten = roundAmount(Math.min(Math.max(0, eatenNow), cooked));
  return {
    portionsCooked: cooked,
    eatenNow: eaten,
    leftoverPortions: roundAmount(cooked - eaten),
  };
}

export function leftoverUseBy(cookedAt: string, days: number = DEFAULT_LEFTOVER_DAYS): string {
  return addDays(cookedAt, days);
}

export interface PortionConsumption {
  readonly taken: number;
  readonly remaining: number;
}

/** Take portions from a batch without ever going below zero. */
export function consumePortions(available: number, take: number): PortionConsumption {
  const batch = roundAmount(Math.max(0, available));
  const taken = roundAmount(Math.min(batch, Math.max(0, take)));
  return { taken, remaining: roundAmount(batch - taken) };
}
