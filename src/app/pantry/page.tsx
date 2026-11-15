import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { ingredients } from "@/db/schema";
import { auth } from "@/lib/auth/server";
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

  const db = getDb();
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(ingredients)
    .where(sql`${ingredients.userId} = ${appUser.id}`);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pantry</h1>
          <p className="text-sm text-neutral-500">{session.user.email}</p>
        </div>
        <SignOutButton />
      </header>

      <section className="mt-10 rounded-xl border border-neutral-200 p-6 dark:border-neutral-800">
        <p className="text-sm text-neutral-500">Catalogue loaded</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{row?.total ?? 0}</p>
        <p className="mt-1 text-sm text-neutral-500">
          ingredients seeded. The pantry table is the next screen to build.
        </p>
      </section>
    </main>
  );
}
