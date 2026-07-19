import { Skeleton } from "@/components/ui/skeleton"

export default function NotebooksLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Skeleton className="h-8 w-56 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-36 rounded-full" />
      </div>

      <Skeleton className="mt-6 mb-4 h-7 w-40" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-[220px] rounded-2xl" />
        ))}
      </div>
    </div>
  )
}
