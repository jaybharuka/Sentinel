import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";
import { getCurrentSessionId } from "@/lib/session";

export async function POST() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const currentSessionId = await getCurrentSessionId();
  // Guard explicitly rather than pass a possibly-null value into Prisma's
  // `not` filter - `{ not: undefined }` means "don't filter on this field
  // at all," which would delete the current session too. This should never
  // actually be null here (getCurrentMerchant() already succeeded, meaning
  // a valid session existed moments ago), but the failure mode of getting
  // it wrong is "log the merchant out of their own device," worth guarding
  // explicitly rather than trusting that invariant silently.
  if (!currentSessionId) {
    return Response.json({ error: "Could not identify current session" }, { status: 400 });
  }

  const { count } = await prisma.session.deleteMany({
    where: { merchantId: merchant.id, id: { not: currentSessionId } },
  });

  return Response.json({ revokedCount: count });
}
