import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

// Deliberately not scoped by merchantId, unlike /api/metrics: this is a
// shared public benchmark result (same Kaggle rows, same model), not
// per-tenant data - every logged-in merchant sees the same number, the way
// a model card would report one accuracy figure rather than one per user.
// Still auth-gated so it's not exposed unauthenticated.
export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rows = await prisma.transaction.findMany({
    where: { source: "kaggle_benchmark", isLabeledFraud: { not: null } },
  });

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;
  let fallbackUsedCount = 0;

  for (const row of rows) {
    if (row.usedFallback) fallbackUsedCount++;

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
    totalScored: rows.length,
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision,
    recall,
    f1,
    fallbackUsedCount,
    fallbackRate: rows.length > 0 ? fallbackUsedCount / rows.length : null,
    datasetSize: 2242,
    datasetSource: "Kaggle - Credit Card Fraud Detection (mlg-ulb)",
    datasetUrl: "https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud",
  });
}
