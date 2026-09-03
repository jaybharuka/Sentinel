import { Suspense } from "react";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export default function ResetPasswordPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center font-display text-lg font-semibold tracking-tight"
        >
          Sentinel
        </Link>
        <Suspense fallback={<p className="text-muted-foreground text-center text-sm">Loading…</p>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
