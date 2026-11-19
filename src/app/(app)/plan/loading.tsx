import { PageHeaderSkeleton, Skeleton } from "@/components/skeletons";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default function PlanLoading() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-8 pb-28 sm:px-6">
      <span className="sr-only">Loading week plan</span>
      <PageHeaderSkeleton action />

      <div className="space-y-3">
        {DAY_KEYS.map((key) => (
          <section
            key={key}
            className="rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
