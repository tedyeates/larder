"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav-items";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * App shell navigation. Renders as a sidebar on wide viewports and a bottom
 * tab bar on narrow ones — same links, same markup, CSS-only layout switch
 * so there is exactly one nav to test.
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="border-foreground/10 md:h-screen md:w-56 md:border-r md:p-4 fixed bottom-0 left-0 right-0 border-t bg-background md:sticky md:top-0 md:border-t-0"
    >
      <ul className="flex justify-around md:flex-col md:justify-start md:gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
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
