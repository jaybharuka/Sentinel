import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentMerchant } from "@/lib/currentMerchant";
import { Header } from "@/components/layout/Header";
import { CheckoutDemo } from "@/components/checkout/CheckoutDemo";
import { ToastProvider } from "@/components/ui/toast";

export default async function DemoPaymentPage() {
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/login");

  return (
    <div className="min-h-screen bg-background px-6 py-10 md:px-10">
      <div className="mx-auto max-w-xl">
        <Header merchant={merchant} />
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:text-foreground mb-4 inline-block text-sm"
        >
          ← Back to dashboard
        </Link>
        <ToastProvider>
          <CheckoutDemo />
        </ToastProvider>
      </div>
    </div>
  );
}
