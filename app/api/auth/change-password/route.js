import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

const MIN_PASSWORD_LENGTH = 8;

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

  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");

  if (!(await bcrypt.compare(currentPassword, merchant.password))) {
    return Response.json({ error: "Current password is incorrect" }, { status: 401 });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.merchant.update({
    where: { id: merchant.id },
    data: { password: hashedPassword },
  });

  return Response.json({ ok: true });
}
