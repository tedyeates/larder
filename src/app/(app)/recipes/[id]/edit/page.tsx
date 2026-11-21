import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { RecipeForm } from "@/components/recipe-form";
import { getDb } from "@/db";
import { recipeIngredients, recipes } from "@/db/schema";
import { auth } from "@/lib/auth/server";
import { listIngredientOptions } from "@/lib/catalogue";
import { getOrCreateAppUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
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

  const [ingredients, lines] = await Promise.all([
    listIngredientOptions(user.id),
    db
      .select({
        ingredientId: recipeIngredients.ingredientId,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipe.id))
      .orderBy(recipeIngredients.sortOrder),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 pt-8 pb-28 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Edit recipe</h1>
        <p className="text-sm text-neutral-500">{recipe.title}</p>
      </header>

      <RecipeForm
        ingredients={ingredients}
        initial={{
          recipeId: recipe.id,
          title: recipe.title,
          servings: recipe.servings,
          steps: recipe.steps.map((step) => step.text),
          aiNotes: recipe.aiNotes ?? "",
          lines: lines.map((line) => ({
            ingredientId: line.ingredientId,
            quantity: line.quantity,
            unit: line.unit,
          })),
        }}
      />
    </main>
  );
}
