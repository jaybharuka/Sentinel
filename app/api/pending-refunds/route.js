import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

// Surfaces rows stuck in the refundExecuted: null window - decision made
// (actionTaken: auto_refund), Razorpay call not yet resolved (or the
// process crashed between the decision and the call). A hackathon-scope
// visibility tool, not a reconciliation job: it doesn't retry or resolve
// anything, it just makes sure a pending row is never invisible.
export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rows = await prisma.transaction.findMany({
    where: {
      merchantId: merchant.id,
      source: "razorpay_live",
      refundExecuted: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, txnId: true, amount: true, createdAt: true },
  });

  return Response.json({ count: rows.length, rows });
}
