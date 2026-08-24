import { prisma } from "@/lib/prisma";
import { getSessionMerchantId } from "@/lib/session";

/**
 * Resolves the logged-in merchant from the session cookie. Node-runtime
 * only (uses Prisma) - middleware.js verifies the token's validity at the
 * edge without this, since Prisma can't run there.
 */
export async function getCurrentMerchant() {
  const merchantId = await getSessionMerchantId();
  if (!merchantId) return null;
  return prisma.merchant.findUnique({ where: { id: merchantId } });
}
