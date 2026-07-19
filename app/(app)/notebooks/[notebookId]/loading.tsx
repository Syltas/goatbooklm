import { Skeleton } from "@/components/ui/skeleton"

export default function NotebookDetailLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center border-b border-border px-6 py-3">
        <Skeleton className="h-6 w-64" />
      </div>

      <div className="flex min-h-0 flex-1 divide-x divide-border overflow-hidden">
        <div className="hidden w-[300px] shrink-0 flex-col gap-3 p-4 md:flex">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
        <div className="hidden w-[300px] shrink-0 flex-col gap-3 p-4 md:flex">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
