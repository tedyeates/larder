import Link from "next/link";
import { redirect } from "next/navigation";
import { WeekBoard } from "@/components/week-board";
import { addDays } from "@/domain/dates";
import { auth } from "@/lib/auth/server";
import {
  currentWeek,
  derivePlannedCooks,
  listLeftovers,
  listRecipeOptions,
  loadWeek,
  weekDays,
} from "@/lib/plan";
import { getOrCreateAppUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const WEEK_LABEL = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export default async function WeekPage({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) redirect(`/plan/${currentWeek()}`);

  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const user = await getOrCreateAppUser({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const [view, recipes, leftovers] = await Promise.all([
    loadWeek(user.id, week),
    listRecipeOptions(user.id),
    listLeftovers(user.id),
  ]);

  const days = weekDays(week);
  const first = days[0];
  const last = days[6];
  const plannedCooks = derivePlannedCooks(view.entries);

  return (
    <main className="mx-auto max-w-3xl px-5 pt-8 pb-28 sm:px-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
          <p className="text-sm text-neutral-500">
            {first && last
              ? `${WEEK_LABEL.format(new Date(`${first}T00:00:00Z`))} – ${WEEK_LABEL.format(new Date(`${last}T00:00:00Z`))}`
              : week}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href={`/plan/${addDays(week, -7)}`}
            className="rounded-lg border border-neutral-300 px-2.5 py-1 dark:border-neutral-700"
          >
            ←
          </Link>
          <Link
            href={`/plan/${addDays(week, 7)}`}
            className="rounded-lg border border-neutral-300 px-2.5 py-1 dark:border-neutral-700"
          >
            →
          </Link>
        </div>
      </header>

      <WeekBoard
        week={week}
        days={days}
        status={view.status}
        entries={view.entries}
        recipes={recipes}
        leftovers={leftovers}
        plannedCooks={plannedCooks}
      />
    </main>
  );
}
