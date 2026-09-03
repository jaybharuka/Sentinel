import { prisma } from "@/lib/prisma";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const token = String(body.token || "");
  if (!token) {
    return Response.json({ error: "Missing token" }, { status: 400 });
  }

  const merchant = await prisma.merchant.findUnique({ where: { verificationToken: token } });
  if (!merchant) {
    return Response.json(
      { error: "Invalid or already-used verification link." },
      { status: 400 }
    );
  }
  if (!merchant.verificationTokenExpiry || merchant.verificationTokenExpiry < new Date()) {
    return Response.json(
      { error: "This verification link has expired. Request a new one from the dashboard." },
      { status: 400 }
    );
  }

  await prisma.merchant.update({
    where: { id: merchant.id },
    data: { emailVerified: true, verificationToken: null, verificationTokenExpiry: null },
  });

  return Response.json({ verified: true });
}
