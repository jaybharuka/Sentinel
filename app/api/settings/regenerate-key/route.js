import { regenerateApiKey, toPublicSettings } from "@/lib/merchantSettings";
import { getCurrentMerchant } from "@/lib/currentMerchant";

export async function POST() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { settings, fullKey } = await regenerateApiKey(merchant.id);
  // fullKey is returned here and only here - this response is the one
  // moment the merchant can see it. It is never persisted or retrievable
  // again after this.
  return Response.json({ ...toPublicSettings(settings), apiKey: fullKey });
}
