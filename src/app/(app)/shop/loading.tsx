import { ListSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/skeletons";

export default function ShopLoading() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-8 pb-28 sm:px-6">
      <span className="sr-only">Loading shopping list</span>
      <PageHeaderSkeleton />

      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>

        <ListSkeleton rows={7} leading />

        <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <Skeleton className="mb-3 h-4 w-24" />
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem_5rem_auto]">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-16" />
          </div>
        </section>
      </div>
    </main>
  );
}
