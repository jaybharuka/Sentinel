export default function Loading() {
  return (
    <div className="min-h-screen bg-background px-6 py-10 md:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 h-10 w-48 animate-pulse rounded-md bg-muted" />
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                <div className="aspect-square animate-pulse rounded-md bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-lg border border-border bg-muted/50" />
        </div>
      </div>
    </div>
  );
}
