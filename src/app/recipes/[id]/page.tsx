import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AppNav } from "@/components/app-nav";
import { getDb } from "@/db";
import { ingredients, recipeIngredients, recipes } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { getOrCreateAppUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const db = getDb();
  const [recipe] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.userId, user.id)))
    .limit(1);
  if (!recipe) notFound();

  const lines = await db
    .select({
      id: recipeIngredients.id,
      rawText: recipeIngredients.rawText,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      ingredientName: ingredients.name,
    })
    .from(recipeIngredients)
    .leftJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(eq(recipeIngredients.recipeId, recipe.id))
    .orderBy(recipeIngredients.sortOrder);

  const totalMinutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);

  return (
    <main className="mx-auto max-w-2xl px-5 pt-8 pb-28 sm:px-6">
      <Link href="/recipes" className="text-sm text-neutral-500 hover:underline">
        ← Recipes
      </Link>

      <header className="mt-3 mb-6 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{recipe.title}</h1>
        <p className="text-sm text-neutral-500">
          {recipe.servings} servings
          {totalMinutes > 0 ? ` · ${totalMinutes} min` : ""}
          {recipe.sourceUrl ? " · from a link" : ""}
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">
          Ingredients
        </h2>
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {lines.map((line) => (
            <li key={line.id} className="px-4 py-2.5 text-sm">
              {line.quantity !== null && line.unit !== null ? (
                <span className="tabular-nums">
                  {line.quantity} {line.unit}
                </span>
              ) : null}
              <span className="ml-2">{line.ingredientName ?? line.rawText}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">
          Method
        </h2>
        {recipe.steps.length === 0 ? (
          <p className="text-sm text-neutral-500">No steps recorded yet.</p>
        ) : (
          <ol className="space-y-4">
            {recipe.steps.map((step, index) => (
              <li key={step.text} className="flex gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-neutral-900 text-xs font-medium text-white dark:bg-white dark:text-neutral-900">
                  {index + 1}
                </span>
                <div className="prose prose-sm max-w-none text-neutral-800 dark:prose-invert dark:text-neutral-200">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.text}</ReactMarkdown>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <AppNav />
    </main>
  );
}
