import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  const merchant = await prisma.merchant.findUnique({ where: { email } });
  // Same "invalid email or password" message either way - don't reveal
  // which part was wrong (standard practice, avoids account enumeration).
  if (!merchant || !(await bcrypt.compare(password, merchant.password))) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await setSessionCookie(merchant.id);

  return Response.json({ id: merchant.id, name: merchant.name, email: merchant.email });
}
