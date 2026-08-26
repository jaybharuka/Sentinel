import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentMerchant } from "@/lib/currentMerchant";
import { Header } from "@/components/layout/Header";
import { DashboardContent } from "@/components/dashboard/DashboardContent";
import { ToastProvider } from "@/components/ui/toast";

export default async function DashboardPage() {
  const merchant = await getCurrentMerchant();
  // Middleware only verifies the JWT's signature/expiry, not that the
  // merchant row still exists - this covers that gap.
  if (!merchant) redirect("/login");

  return (
    <div className="min-h-screen bg-background px-6 py-10 md:px-10">
      <div className="mx-auto max-w-6xl">
        <Header merchant={merchant} />
        <ToastProvider>
          {/* DashboardContent reads the active tab from useSearchParams() -
              Next requires a Suspense boundary around any client component
              using it. */}
          <Suspense fallback={<p className="text-muted-foreground text-sm">Loading dashboard…</p>}>
            <DashboardContent />
          </Suspense>
        </ToastProvider>
      </div>
    </div>
  );
}
