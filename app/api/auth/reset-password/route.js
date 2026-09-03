import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const token = String(body.token || "");
  const password = String(body.password || "");
  const confirmPassword = String(body.confirmPassword || "");

  if (!token) {
    return Response.json({ error: "Missing token" }, { status: 400 });
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

  const merchant = await prisma.merchant.findUnique({ where: { resetToken: token } });
  if (!merchant) {
    return Response.json(
      { error: "Invalid or already-used reset link." },
      { status: 400 }
    );
  }
  if (!merchant.resetTokenExpiry || merchant.resetTokenExpiry < new Date()) {
    return Response.json(
      { error: "This reset link has expired. Request a new one." },
      { status: 400 }
    );
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  // updateMany with the token re-checked in the WHERE clause, not a
  // find-then-update on the id - so two concurrent requests racing the
  // same token (e.g. a link opened twice) can't both succeed. Whichever
  // request's update runs second finds 0 matching rows, since the first
  // one already cleared resetToken.
  const { count } = await prisma.merchant.updateMany({
    where: { resetToken: token },
    data: { password: hashedPassword, resetToken: null, resetTokenExpiry: null },
  });
  if (count === 0) {
    return Response.json(
      { error: "Invalid or already-used reset link." },
      { status: 400 }
    );
  }

  return Response.json({ reset: true });
}
