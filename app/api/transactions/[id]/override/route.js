import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

const REASON_LABELS = {
  trusted_customer: "Trusted customer",
  false_positive: "False positive",
  customer_contacted: "Customer contacted us",
  other: "Other",
  // Distinct from the four reasons above (all picked deliberately from the
  // full override form on the Transactions tab) - this one is only ever
  // sent by the Review Queue's one-click "Approve" action, which
  // intentionally skips the reason picker for speed. Keeping it a separate,
  // honest label rather than defaulting to e.g. "trusted_customer" means
  // the audit trail never claims a reason the merchant didn't actually pick.
  queue_quick_approve: "Approved from Review Queue (no reason given)",
};

// Human override: a merchant reversing a hold_for_review or auto_refund
// decision they've reviewed and disagree with. Deliberately one-directional
// (flagged -> allowed) - that's the only case these four reason options make
// sense for, and the only case this feature was asked to cover. Sets
// actionTaken: "allow_overridden" rather than "allow" so the audit trail can
// always distinguish an original policy decision from a human reversal of
// one, even after the fact.
//
// Never touches Razorpay. If a real refund already executed
// (refundExecuted: true), overriding records disagreement for the audit
// trail - it does not and cannot un-refund; that needs manual action in
// Razorpay's own dashboard, out of scope here. No executeRefund()/sendAlert()
// call exists anywhere in this file on purpose.
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

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const reason = String(body.reason || "");
  if (!Object.hasOwn(REASON_LABELS, reason)) {
    return Response.json(
      { error: `reason must be one of: ${Object.keys(REASON_LABELS).join(", ")}` },
      { status: 400 }
    );
  }
  const otherText = String(body.otherText || "").trim().slice(0, 300);
  if (reason === "other" && !otherText) {
    return Response.json({ error: "otherText is required when reason is \"other\"" }, { status: 400 });
  }

  const existing = await prisma.transaction.findUnique({ where: { id: txnId } });
  if (!existing || existing.merchantId !== merchant.id) {
    return Response.json({ error: "Transaction not found" }, { status: 404 });
  }
  if (existing.policyDecision !== "hold_for_review" && existing.policyDecision !== "auto_refund") {
    return Response.json(
      { error: "Only hold_for_review or auto_refund decisions can be overridden" },
      { status: 400 }
    );
  }
  if (existing.humanOverride) {
    return Response.json({ error: "This transaction has already been overridden" }, { status: 400 });
  }

  const overrideReason = reason === "other" ? `Other: ${otherText}` : REASON_LABELS[reason];
  const overriddenAt = new Date();

  const refundNote =
    existing.actionTaken === "auto_refund" && existing.refundExecuted
      ? ` A real Razorpay refund (${existing.refundId}) had already been executed for this transaction and was NOT reversed automatically - reversing a completed refund requires manual action in Razorpay's own dashboard.`
      : "";

  const updatedReasons = [
    ...(existing.reasons || []),
    `Human override at ${overriddenAt.toISOString()}: ${overrideReason}. Reversed ${existing.policyDecision} to allow.${refundNote}`,
  ];

  const updated = await prisma.transaction.update({
    where: { id: txnId },
    data: {
      humanOverride: true,
      overrideReason,
      overriddenAt,
      actionTaken: "allow_overridden",
      reasons: updatedReasons,
    },
  });

  return Response.json(updated);
}
