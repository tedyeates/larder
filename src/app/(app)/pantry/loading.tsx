import { ListSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/skeletons";

export default function PantryLoading() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-8 pb-28 sm:px-6 sm:pt-10">
      <span className="sr-only">Loading pantry</span>
      <PageHeaderSkeleton action />

      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <Skeleton className="h-10 w-full sm:max-w-xs" />
            <Skeleton className="h-10 w-24 shrink-0" />
          </div>
          <Skeleton className="h-9 w-full sm:w-64" />
        </div>

        <Skeleton className="h-4 w-52" />

        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="ml-1 h-3 w-20" />
            <ListSkeleton rows={4} />
          </div>
          <div className="space-y-2">
            <Skeleton className="ml-1 h-3 w-28" />
            <ListSkeleton rows={3} />
          </div>
        </div>
      </div>
    </main>
  );
}
