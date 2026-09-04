"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

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
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6">
        <Link href="/dashboard" className="font-display text-base font-semibold tracking-tight">
          Sentinel
        </Link>
        <nav className="flex flex-wrap gap-x-3 gap-y-1 text-sm sm:gap-x-4">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  active
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }
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
