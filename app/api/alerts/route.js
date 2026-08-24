import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const alerts = await prisma.alert.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { transaction: { select: { txnId: true, amount: true, policyDecision: true } } },
  });
  return Response.json({ alerts });
}
