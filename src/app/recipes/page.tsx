import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { getDb } from "@/db";
import { recipes } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { getOrCreateAppUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const rows = await getDb()
    .select({ id: recipes.id, title: recipes.title, servings: recipes.servings })
    .from(recipes)
    .where(eq(recipes.userId, user.id))
    .orderBy(asc(recipes.title));

  return (
    <main className="mx-auto max-w-3xl px-5 pt-8 pb-28 sm:px-6">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recipes</h1>
          <p className="text-sm text-neutral-500">{rows.length} in the library</p>
        </div>
        <Link
          href="/recipes/new"
          className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          New recipe
        </Link>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No recipes yet. Add one and it becomes available to the week plan.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {rows.map((recipe) => (
            <li key={recipe.id}>
              <Link
                href={`/recipes/${recipe.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <span className="text-sm font-medium">{recipe.title}</span>
                <span className="text-xs text-neutral-500">{recipe.servings} servings</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <AppNav />
    </main>
  );
}
