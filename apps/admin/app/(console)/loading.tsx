import { Skeleton } from "../../components/ui";

/** Shown while a console page streams in; mirrors the overview layout. */
export default function Loading() {
  return (
    <div className="space-y-5 sm:space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="space-y-3 rounded-2xl bg-masthead px-5 py-5 sm:px-8 sm:py-8">
        <span className="block h-3 w-36 rounded-md bg-rail-2" />
        <span className="block h-8 w-64 max-w-full rounded-md bg-rail-2 sm:h-10" />
      </div>
      <Skeleton className="h-11 rounded-xl" />
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-surface xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 p-4 sm:p-6">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[62px] rounded-xl sm:h-[70px]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-6 lg:col-span-2">
          <Skeleton className="h-5 w-44" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-6">
          <Skeleton className="h-5 w-32" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </div>
    </div>
  );
}
