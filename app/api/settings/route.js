import { prisma } from "@/lib/prisma";
import { getMerchantSettings, toPublicSettings } from "@/lib/merchantSettings";
import { getCurrentMerchant } from "@/lib/currentMerchant";
import { validatePolicyBounds } from "@/lib/validatePolicyBounds";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(input) {
  const { errors, values } = validatePolicyBounds(input);
  const alertEmail = input.alertEmail ? String(input.alertEmail).trim() : null;

  if (alertEmail && !EMAIL_RE.test(alertEmail)) {
    errors.push("alertEmail must be a valid email address");
  }

  return { errors, values: { ...values, alertEmail } };
}

export async function GET() {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const settings = await getMerchantSettings(merchant.id);
  return Response.json(toPublicSettings(settings));
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

  return Response.json(toPublicSettings(updated));
}
