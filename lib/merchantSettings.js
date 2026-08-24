import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const DEFAULT_MERCHANT_ID = "default_merchant";

function generateApiKey() {
  return `sk_live_${crypto.randomBytes(24).toString("hex")}`;
}

/**
 * Fetches the single merchant's policy settings, creating the default row
 * on first call if it doesn't exist yet (schema defaults match the values
 * policyGate.js used to hard-code). Upsert instead of a separate seed step
 * so the row is always guaranteed to exist for any caller. Also backfills
 * apiKey for rows created before that field existed - it can't be a schema
 * default (needs a random value per row), so a missing key is generated
 * and persisted here rather than left null.
 */
export async function getMerchantSettings(merchantId = DEFAULT_MERCHANT_ID) {
  const settings = await prisma.merchantSettings.upsert({
    where: { merchantId },
    update: {},
    create: { merchantId, apiKey: generateApiKey() },
  });

  if (!settings.apiKey) {
    return prisma.merchantSettings.update({
      where: { merchantId },
      data: { apiKey: generateApiKey() },
    });
  }

  return settings;
}

export async function regenerateApiKey(merchantId = DEFAULT_MERCHANT_ID) {
  return prisma.merchantSettings.update({
    where: { merchantId },
    data: { apiKey: generateApiKey() },
  });
}

export { DEFAULT_MERCHANT_ID, generateApiKey };
