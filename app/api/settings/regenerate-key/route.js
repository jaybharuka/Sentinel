import { regenerateApiKey } from "@/lib/merchantSettings";
import { getCurrentMerchant } from "@/lib/currentMerchant";

export async function POST() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const updated = await regenerateApiKey(merchant.id);
  return Response.json(updated);
}
