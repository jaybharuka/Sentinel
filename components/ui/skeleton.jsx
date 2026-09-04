import { cn } from "@/lib/utils";

// Same animate-pulse/rounded-md/bg-muted language already established in
// app/demo-store/loading.js - this just gives that pattern a reusable name
// for the client-fetched sections (dashboard tabs, settings) that a route-
// level loading.js can't cover, since their data loads after the shell
// already rendered, not before.
export function Skeleton({ className, ...props }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
