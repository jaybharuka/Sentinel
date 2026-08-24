import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rows = await prisma.transaction.findMany({
    where: { merchantId: merchant.id, isLabeledFraud: { not: null } },
  });

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;
  let falsePositiveCost = 0;
  let fallbackUsedCount = 0;

  for (const row of rows) {
    if (row.usedFallback) fallbackUsedCount++;

    const flagged = row.actionTaken === "hold_for_review" || row.actionTaken === "auto_refund";

    if (flagged && row.isLabeledFraud) {
      truePositives++;
    } else if (flagged && !row.isLabeledFraud) {
      falsePositives++;
      falsePositiveCost += row.amount;
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
    falsePositiveCost,
    fallbackUsedCount,
    fallbackRate: rows.length > 0 ? fallbackUsedCount / rows.length : null,
  });
}
