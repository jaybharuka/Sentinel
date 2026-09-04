"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/demo-store", label: "Demo Store" },
  { href: "/settings", label: "Settings" },
];

export function Header({ merchant }) {
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    // A real toolbar surface (bordered, filled, elevated) rather than text
    // floating directly on the page background with only a border-bottom -
    // the contained card also softens the empty space between the brand+nav
    // cluster and the account cluster, since the eye now reads one bounded
    // bar rather than two disconnected floating groups with a gap between.
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm sm:px-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href="/dashboard" className="font-display text-xl font-bold tracking-tight">
          Sentinel
        </Link>
        <nav className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                // Same pill-on-active grammar as the Tabs component
                // (data-[state=active]:bg-background inside a muted
                // container) - one consistent "this is the active thing"
                // visual language across the whole app, not a second one
                // invented just for this nav.
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {/* One identifying line (email), not name+email stacked - the name
          now has a more useful home as the Dashboard page's own heading
          (see DashboardContent.jsx), so repeating it here on top of that
          was double coverage for the same fact within one viewport. Email
          stays as the account's unique identifier, still hidden below sm:
          it's redundant with the account details already on the Settings
          page, and there's no room for it next to the nav + logout button
          at a 390px viewport without either clipping (the original bug)
          or wrapping into a third row. */}
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <p className="text-muted-foreground hidden text-sm sm:block">{merchant.email}</p>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Log out
        </Button>
      </div>
    </div>
  );
}
