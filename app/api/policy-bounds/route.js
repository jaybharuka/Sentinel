import { prisma } from "@/lib/prisma";
import { startOfDay, endOfDay } from "@/lib/ingestTransaction";
import { getMerchantSettings } from "@/lib/merchantSettings";
import { getCurrentMerchant } from "@/lib/currentMerchant";

export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const now = new Date();
  const settings = await getMerchantSettings(merchant.id);

  // Same day-boundary, field (timestamp, not createdAt), and source filter
  // the policy gate itself uses to enforce the daily cap in
  // lib/ingestTransaction.js, so this panel always agrees with what's
  // actually being enforced - and so clicking the demo auto_refund button
  // never visibly moves this gauge (no real money moved).
  //
  // This counts approved auto_refund *decisions*, not confirmed successful
  // Razorpay refunds - a failed real refund still consumes budget. That's
  // intentional (see lib/ingestTransaction.js), so the field is named
  // "Authorized" rather than "Refunded" to avoid implying every ₹ here was
  // actually paid out.
  const agg = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: {
      merchantId: settings.merchantId,
      actionTaken: "auto_refund",
      source: "razorpay_live",
      timestamp: { gte: startOfDay(now), lte: endOfDay(now) },
    },
  });

  return Response.json({
    maxSingleRefund: settings.autoRefundMaxAmount,
    dailyRefundCap: settings.dailyRefundCap,
    minRiskScore: settings.autoRefundMinRiskScore,
    minConfidence: settings.autoRefundMinConfidence,
    holdThreshold: settings.holdForReviewMinRiskScore,
    dailyAuthorizedToday: agg._sum.amount || 0,
  });
}
