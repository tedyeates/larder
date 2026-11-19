/**
 * Loading placeholders shared by the tab routes. They mirror the real pages'
 * containers so the swap from skeleton to content doesn't shift the layout.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-800 ${className}`}
    />
  );
}

export function PageHeaderSkeleton({ action = false }: { action?: boolean }) {
  return (
    <header className="mb-5 flex items-start justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-40" />
      </div>
      {action && <Skeleton className="h-9 w-24 shrink-0" />}
    </header>
  );
}

export function ListSkeleton({ rows = 5, leading = false }: { rows?: number; leading?: boolean }) {
  const keys = ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"];
  return (
    <div className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
      {keys.slice(0, rows).map((key) => (
        <div key={key} className="flex items-center gap-3 px-4 py-3">
          {leading && <Skeleton className="h-5 w-5 shrink-0 rounded-full" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}
