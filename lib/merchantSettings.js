import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const DEFAULT_MERCHANT_ID = "default_merchant";
// "sk_live_" (8 chars) + 8 hex chars, e.g. "sk_live_a1b2c3d4" - shown
// permanently for display ("sk_live_a1b2c3d4...") and used to narrow the
// auth lookup in app/api/v1/transactions/route.js before the actual
// constant-time hash comparison.
const API_KEY_PREFIX_LENGTH = 16;

export function hashApiKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// Generates a brand-new key and returns the full plaintext value alongside
// what actually gets persisted (a SHA-256 hash and the display prefix).
// This is the ONLY place in the app that ever produces the full key - it
// is never stored anywhere, so the caller (regenerateApiKey(), below) must
// hand it to the merchant in that same response. There is no way to
// recover it after that.
function generateApiKey() {
  const fullKey = `sk_live_${crypto.randomBytes(24).toString("hex")}`;
  return {
    fullKey,
    hash: hashApiKey(fullKey),
    prefix: fullKey.slice(0, API_KEY_PREFIX_LENGTH),
  };
}

/**
 * Fetches a merchant's policy settings, creating the default row on first
 * call if it doesn't exist yet (schema defaults match the values
 * policyGate.js used to hard-code). Upsert instead of a separate seed step
 * so the row is always guaranteed to exist for any caller. Deliberately
 * does NOT auto-generate an API key - a key can only be created by an
 * explicit "Generate"/"Regenerate" action on the settings page, since
 * that's the only moment the UI has to show the full value to the
 * merchant. A settings row with no key yet (or one migrated off the old
 * plaintext field - see prisma/migrations/20260903172804_hash_api_keys)
 * just has apiKeyHash: null until the merchant generates one.
 */
export async function getMerchantSettings(merchantId = DEFAULT_MERCHANT_ID) {
  return prisma.merchantSettings.upsert({
    where: { merchantId },
    update: {},
    create: { merchantId },
  });
}

// Generates and persists a new key's hash, returning the full plaintext
// key exactly once. Callers must surface it to the merchant immediately
// with clear "copy this now" messaging (see components/settings/
// SettingsContent.jsx) - it cannot be shown again after this call returns.
export async function regenerateApiKey(merchantId = DEFAULT_MERCHANT_ID) {
  const { fullKey, hash, prefix } = generateApiKey();
  const settings = await prisma.merchantSettings.upsert({
    where: { merchantId },
    update: { apiKeyHash: hash, apiKeyPrefix: prefix },
    create: { merchantId, apiKeyHash: hash, apiKeyPrefix: prefix },
  });
  return { settings, fullKey };
}

// Never send apiKeyHash to the client - it's not a secret in the sense a
// plaintext key would be (SHA-256 can't be reversed), but there's no
// reason to expose it either. Every API response involving settings goes
// through this.
export function toPublicSettings(settings) {
  const { apiKeyHash, ...rest } = settings;
  return rest;
}

export { DEFAULT_MERCHANT_ID };
