import { redirect } from "next/navigation";
import { RecipeForm } from "@/components/recipe-form";
import { auth } from "@/lib/auth/server";
import { listIngredientOptions } from "@/lib/catalogue";
import { getOrCreateAppUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function NewRecipePage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const ingredients = await listIngredientOptions(user.id);

  return (
    <main className="mx-auto max-w-3xl px-5 pt-8 pb-28 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">New recipe</h1>
        <p className="text-sm text-neutral-500">Amounts are in the ingredient&apos;s own units.</p>
      </header>

      <RecipeForm ingredients={ingredients} />
    </main>
  );
}
