export type NavItem = {
  href: string;
  label: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/plan", label: "Plan" },
  { href: "/plan/review", label: "Review" },
  { href: "/shopping", label: "Shopping" },
  { href: "/pantry", label: "Pantry" },
  { href: "/meals", label: "Meals" },
  { href: "/recipes", label: "Recipes" },
  { href: "/recipes/resolve", label: "Resolve" },
  { href: "/ingredients", label: "Ingredients" },
  { href: "/shops", label: "Shops" },
  { href: "/settings", label: "Settings" },
];
