export default function Loading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-stone-800" />
      <p className="text-sm font-medium text-stone-500 animate-pulse">Loading…</p>
    </div>
  );
}
