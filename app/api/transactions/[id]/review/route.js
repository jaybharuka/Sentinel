import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

// "Keep decision": a merchant looked at a flagged transaction in the
// Review Queue and confirmed the original policy/AI decision should stand,
// without reversing it. Deliberately does not touch policyDecision,
// actionTaken, humanOverride, or call executeRefund/sendAlert - the only
// state change is reviewedAt, which removes the row from the Review Queue
// (see app/api/review-queue/route.js) while leaving the audit trail
// otherwise exactly as the policy gate produced it.
export async function POST(request, { params }) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const txnId = Number(id);
  if (!Number.isInteger(txnId)) {
    return Response.json({ error: "Invalid transaction id" }, { status: 400 });
  }

  const existing = await prisma.transaction.findUnique({ where: { id: txnId } });
  if (!existing || existing.merchantId !== merchant.id) {
    return Response.json({ error: "Transaction not found" }, { status: 404 });
  }
  if (existing.policyDecision !== "hold_for_review" && existing.policyDecision !== "auto_refund") {
    return Response.json(
      { error: "Only hold_for_review or auto_refund decisions can be reviewed" },
      { status: 400 }
    );
  }
  if (existing.humanOverride) {
    return Response.json({ error: "This transaction was already overridden" }, { status: 400 });
  }
  if (existing.reviewedAt) {
    return Response.json({ error: "This transaction has already been reviewed" }, { status: 400 });
  }

  const reviewedAt = new Date();
  const updatedReasons = [
    ...(existing.reasons || []),
    `Reviewed at ${reviewedAt.toISOString()}: decision confirmed, no change.`,
  ];

  const updated = await prisma.transaction.update({
    where: { id: txnId },
    data: { reviewedAt, reasons: updatedReasons },
  });

  return Response.json(updated);
}
