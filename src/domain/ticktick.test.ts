import { describe, expect, it } from "vitest";
import { shoppingTaskTitle } from "./ticktick";

describe("shoppingTaskTitle", () => {
  it("includes the amount when there is one", () => {
    expect(shoppingTaskTitle({ label: "Flour", display: "500 g" })).toBe("Flour — 500 g");
  });

  it("keeps the bare name when there is no amount", () => {
    expect(shoppingTaskTitle({ label: "Kitchen roll", display: "" })).toBe("Kitchen roll");
  });
});
