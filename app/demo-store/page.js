import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentMerchant } from "@/lib/currentMerchant";
import { Header } from "@/components/layout/Header";
import { DemoStore } from "@/components/store/DemoStore";
import { fetchDemoProducts } from "@/lib/demoProducts";
import { ToastProvider } from "@/components/ui/toast";

export default async function DemoStorePage() {
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/login");

  // Fetched server-side (not client-side) so the page renders with real
  // data already in hand - Next's loading.js in this same route segment
  // covers the "FakeStoreAPI is slow" case automatically while this await
  // is in flight, and fetchDemoProducts() itself covers "unavailable" by
  // falling back to a static product list on any failure/timeout.
  const products = await fetchDemoProducts();

  return (
    <div className="min-h-screen bg-background px-6 py-10 md:px-10">
      <div className="mx-auto max-w-5xl">
        <Header merchant={merchant} />
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:text-foreground mb-4 inline-block text-sm"
        >
          ← Back to dashboard
        </Link>
        <ToastProvider>
          <DemoStore products={products} />
        </ToastProvider>
      </div>
    </div>
  );
}
