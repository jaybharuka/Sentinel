import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";
import { sendVerificationEmail } from "@/lib/authEmails";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const confirmPassword = String(body.confirmPassword || "");

  if (!name) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }
  if (password !== confirmPassword) {
    return Response.json({ error: "Passwords do not match" }, { status: 400 });
  }

  const existing = await prisma.merchant.findUnique({ where: { email } });
  if (existing) {
    return Response.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const merchant = await prisma.merchant.create({
    data: {
      name,
      email,
      password: hashedPassword,
      // No API key created here - a key can only be generated from an
      // explicit action on the settings page, since that's the only
      // moment the UI has to show the full value (see
      // lib/merchantSettings.js's regenerateApiKey()).
      settings: {
        create: {},
      },
    },
  });

  await setSessionCookie(merchant.id, request.headers.get("user-agent"));

  // Best-effort: a failed verification email must never block signup
  // itself - the merchant can always resend from the dashboard banner
  // (app/api/auth/resend-verification/route.js). Same non-blocking
  // discipline as lib/alerting.js's sendAlert().
  const origin = request.headers.get("origin") || new URL(request.url).origin;
  await sendVerificationEmail(merchant, origin);

  return Response.json({ id: merchant.id, name: merchant.name, email: merchant.email });
}
