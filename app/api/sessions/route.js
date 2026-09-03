import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";
import { getCurrentSessionId } from "@/lib/session";
import { parseUserAgent } from "@/lib/parseUserAgent";

export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const currentSessionId = await getCurrentSessionId();

  // Only ever shows real, currently-valid sessions - an expired row is
  // functionally already logged out (getSessionMerchantId() would reject
  // it), so there's no reason to show it as "active" and let a merchant
  // "revoke" something that already stopped working.
  const sessions = await prisma.session.findMany({
    where: { merchantId: merchant.id, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
  });

  return Response.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      device: parseUserAgent(s.userAgent),
      isCurrent: s.id === currentSessionId,
    })),
  });
}
