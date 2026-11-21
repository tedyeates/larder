/** The TickTick task title carries the amount, so the list reads well at the shop. */
export function shoppingTaskTitle(row: {
  readonly label: string;
  readonly display: string;
}): string {
  return row.display === "" ? row.label : `${row.label} — ${row.display}`;
}
