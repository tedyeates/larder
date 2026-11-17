"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/pantry", label: "Pantry" },
  { href: "/plan", label: "Plan" },
  { href: "/shop", label: "Shop" },
  { href: "/recipes", label: "Recipes" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
      <ul className="mx-auto flex max-w-3xl">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block py-3 text-center text-xs ${
                  active ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-500"
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
