import { Skeleton } from "@/components/ui/skeleton"

export default function NotebooksLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-14">
      <Skeleton className="mb-7 h-[34px] w-72" />

      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-36 rounded-full" />
        <Skeleton className="ml-auto h-10 w-[260px] rounded-full" />
        <Skeleton className="h-10 w-20 rounded-full" />
      </div>

      <Skeleton className="mt-9 mb-4 h-4 w-40" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-[216px] rounded-[20px]" />
        ))}
      </div>
    </div>
  )
}
