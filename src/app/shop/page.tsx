import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ShoppingList } from "@/components/shopping-list";
import { auth } from "@/lib/auth/server";
import { listIngredientOptions } from "@/lib/catalogue";
import { currentWeek } from "@/lib/plan";
import { getOpenList, getShoppingRows } from "@/lib/shop";
import { getOrCreateAppUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const list = await getOpenList(user.id);
  const [rows, ingredients] = await Promise.all([
    getShoppingRows(list.id),
    listIngredientOptions(user.id),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 pt-8 pb-28 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Shop</h1>
        <p className="text-sm text-neutral-500">
          Tick what you bought. It goes straight into the pantry.
        </p>
      </header>

      <ShoppingList rows={rows} ingredients={ingredients} week={currentWeek()} />

      <AppNav />
    </main>
  );
}
