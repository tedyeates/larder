import { ListSkeleton, PageHeaderSkeleton } from "@/components/skeletons";

export default function RecipesLoading() {
  return (
    <main className="mx-auto max-w-3xl px-5 pt-8 pb-28 sm:px-6">
      <span className="sr-only">Loading recipes</span>
      <PageHeaderSkeleton action />
      <ListSkeleton rows={6} />
    </main>
  );
}
