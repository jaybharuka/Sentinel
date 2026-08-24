"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function Header({ merchant }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between border-b pb-4 mb-6">
      <div className="flex gap-4 text-sm">
        <a href="/dashboard" className="font-medium hover:underline">Dashboard</a>
        <a href="/settings" className="font-medium hover:underline">Settings</a>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-medium">{merchant.name}</p>
          <p className="text-muted-foreground text-xs">{merchant.email}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Log out
        </Button>
      </div>
    </div>
  );
}
