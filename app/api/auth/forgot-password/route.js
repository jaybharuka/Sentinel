import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/authEmails";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();

  // Always the same response regardless of what happens below - a
  // different message (or timing - see the deliberate absence of an early
  // return) for "no such email" vs "email sent" would let an attacker
  // enumerate registered accounts. The real work below still only happens
  // when the email actually matches something.
  if (EMAIL_RE.test(email)) {
    const merchant = await prisma.merchant.findUnique({ where: { email } });
    if (merchant) {
      const origin = request.headers.get("origin") || new URL(request.url).origin;
      await sendPasswordResetEmail(merchant, origin);
    }
  }

  return Response.json({ message: GENERIC_MESSAGE });
}
