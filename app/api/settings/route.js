import { prisma } from "@/lib/prisma";
import { getMerchantSettings } from "@/lib/merchantSettings";
import { getCurrentMerchant } from "@/lib/currentMerchant";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(input) {
  const errors = [];

  const autoRefundMaxAmount = Number(input.autoRefundMaxAmount);
  const dailyRefundCap = Number(input.dailyRefundCap);
  const autoRefundMinRiskScore = Number(input.autoRefundMinRiskScore);
  const autoRefundMinConfidence = Number(input.autoRefundMinConfidence);
  const holdForReviewMinRiskScore = Number(input.holdForReviewMinRiskScore);
  const alertEmail = input.alertEmail ? String(input.alertEmail).trim() : null;

  if (!Number.isFinite(autoRefundMaxAmount) || autoRefundMaxAmount < 0) {
    errors.push("autoRefundMaxAmount must be a non-negative number");
  }
  if (!Number.isFinite(dailyRefundCap) || dailyRefundCap < 0) {
    errors.push("dailyRefundCap must be a non-negative number");
  }
  if (
    Number.isFinite(autoRefundMaxAmount) &&
    Number.isFinite(dailyRefundCap) &&
    dailyRefundCap < autoRefundMaxAmount
  ) {
    errors.push("dailyRefundCap must be >= autoRefundMaxAmount");
  }
  for (const [key, value] of [
    ["autoRefundMinRiskScore", autoRefundMinRiskScore],
    ["autoRefundMinConfidence", autoRefundMinConfidence],
    ["holdForReviewMinRiskScore", holdForReviewMinRiskScore],
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`${key} must be a number between 0 and 1`);
    }
  }
  if (alertEmail && !EMAIL_RE.test(alertEmail)) {
    errors.push("alertEmail must be a valid email address");
  }

  return {
    errors,
    values: {
      autoRefundMaxAmount,
      dailyRefundCap,
      autoRefundMinRiskScore,
      autoRefundMinConfidence,
      holdForReviewMinRiskScore,
      alertEmail,
    },
  };
}

export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const settings = await getMerchantSettings(merchant.id);
  return Response.json(settings);
}

export async function POST(request) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const { errors, values } = validate(body);
  if (errors.length > 0) {
    return Response.json({ error: errors.join("; ") }, { status: 400 });
  }

  const updated = await prisma.merchantSettings.upsert({
    where: { merchantId: merchant.id },
    update: values,
    create: { merchantId: merchant.id, ...values },
  });

  return Response.json(updated);
}
