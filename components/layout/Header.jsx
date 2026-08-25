"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export function Header({ merchant }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="font-display text-base font-semibold tracking-tight">
          Sentinel
        </Link>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground">Dashboard</Link>
          <Link href="/settings" className="hover:text-foreground">Settings</Link>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <div className="text-right">
          <p className="text-sm font-medium">{merchant.name}</p>
          <p className="text-xs text-muted-foreground">{merchant.email}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Log out
        </Button>
      </div>
    </div>
  );
}
