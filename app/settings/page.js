import { redirect } from "next/navigation";
import { getCurrentMerchant } from "@/lib/currentMerchant";
import { Header } from "@/components/layout/Header";
import { SettingsContent } from "@/components/settings/SettingsContent";

export default async function SettingsPage() {
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/login");

  return (
    <div className="min-h-screen bg-background px-6 py-10 md:px-10">
      <div className="mx-auto max-w-xl">
        <Header merchant={merchant} />
        <SettingsContent />
      </div>
    </div>
  );
}
