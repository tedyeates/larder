import { redirect } from "next/navigation";
import { PantryTable } from "@/components/pantry-table";
import { auth } from "@/lib/auth/server";
import { listIngredientOptions } from "@/lib/catalogue";
import { getPantryRows } from "@/lib/pantry";
import { getOrCreateAppUser } from "@/lib/users";
import { SignOutButton } from "./sign-out-button";

/** Reads the session cookie on every request. */
export const dynamic = "force-dynamic";

export default async function PantryPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const appUser = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const [rows, ingredients] = await Promise.all([
    getPantryRows(appUser.id),
    listIngredientOptions(appUser.id),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 pt-8 pb-28 sm:px-6 sm:pt-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pantry</h1>
          <p className="text-sm text-neutral-500">{session.user.email}</p>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="/agent-setup"
            className="text-sm text-neutral-500 underline-offset-4 hover:underline"
          >
            Connect an agent
          </a>
          <SignOutButton />
        </div>
      </header>

      <PantryTable rows={rows} ingredients={ingredients} />
    </main>
  );
}
