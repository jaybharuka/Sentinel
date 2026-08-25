import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

// Same precision/recall/F1 math as /api/metrics, but scoped to real
// razorpay_live transactions that have accumulated a real outcome
// (isLabeledFraud is set - true via a genuine payment.dispute.created
// webhook, see markDisputed in app/api/webhooks/razorpay/route.js; false
// is never set automatically here, since "no dispute yet" isn't the same
// claim as "confirmed clean" - a live row only enters this metric once a
// dispute has actually happened. N will be small and grows only as real
// disputes accumulate - that's the honest point of this endpoint: it
// demonstrates the ground-truth mechanism is live and real, not a
// simulation, even though it can't be statistically meaningful yet.
export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rows = await prisma.transaction.findMany({
    where: { merchantId: merchant.id, source: "razorpay_live", isLabeledFraud: { not: null } },
  });

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;

  for (const row of rows) {
    const flagged = row.actionTaken === "hold_for_review" || row.actionTaken === "auto_refund";

    if (flagged && row.isLabeledFraud) {
      truePositives++;
    } else if (flagged && !row.isLabeledFraud) {
      falsePositives++;
    } else if (!flagged && row.isLabeledFraud) {
      falseNegatives++;
    } else {
      trueNegatives++;
    }
  }

  const precision =
    truePositives + falsePositives > 0
      ? truePositives / (truePositives + falsePositives)
      : null;
  const recall =
    truePositives + falseNegatives > 0
      ? truePositives / (truePositives + falseNegatives)
      : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;

  return Response.json({
    totalLabeled: rows.length,
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision,
    recall,
    f1,
  });
}
