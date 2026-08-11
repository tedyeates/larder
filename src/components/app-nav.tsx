"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav-items";

/**
 * Only the most specific matching link is current. Nested hrefs such as
 * /recipes/resolve otherwise light up their parent too, which would leave the
 * nav claiming two current pages at once.
 */
function activeHref(pathname: string, hrefs: string[]) {
  return hrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .reduce((longest, href) => (href.length > longest.length ? href : longest), "");
}

/**
 * App shell navigation. Renders as a sidebar on wide viewports and a bottom
 * tab bar on narrow ones — same links, same markup, CSS-only layout switch
 * so there is exactly one nav to test.
 */
export function AppNav({ plannerAvailable = false }: { plannerAvailable?: boolean }) {
  const pathname = usePathname();
  const items = plannerAvailable
    ? [{ href: "/planner", label: "Planner" }, ...NAV_ITEMS]
    : NAV_ITEMS;
  const current = activeHref(pathname, items.map((item) => item.href));

  return (
    <nav
      aria-label="Primary"
      className="border-foreground/10 md:h-screen md:w-56 md:border-r md:p-4 fixed bottom-0 left-0 right-0 border-t bg-background md:sticky md:top-0 md:border-t-0"
    >
      <ul className="flex justify-around md:flex-col md:justify-start md:gap-1">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href} className="flex-1 md:flex-none">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block px-3 py-3 text-center text-sm md:rounded-md md:text-left ${
                  active
                    ? "font-semibold text-foreground"
                    : "text-foreground/60 hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
