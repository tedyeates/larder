import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppNav } from "./app-nav";

let pathname = "/recipes";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("AppNav", () => {
  it("marks the matching link as the current page", () => {
    pathname = "/recipes";
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Resolve" })).not.toHaveAttribute("aria-current");
  });

  it("marks only the most specific link current on a nested route", () => {
    pathname = "/recipes/resolve";
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "Resolve" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Recipes" })).not.toHaveAttribute("aria-current");
  });

  it("hides Planner unless an Agent Runner is configured", () => {
    const unavailable = render(<AppNav />);
    expect(screen.queryByRole("link", { name: "Planner" })).not.toBeInTheDocument();
    unavailable.unmount();

    render(<AppNav plannerAvailable />);
    expect(screen.getByRole("link", { name: "Planner" })).toHaveAttribute("href", "/planner");
  });
});
