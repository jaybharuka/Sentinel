import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getResendClient, RESEND_FROM_ADDRESS } from "@/lib/resendClient";

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function buildVerificationHtml(link) {
  return `
    <div style="font-family: sans-serif; max-width: 480px;">
      <h2 style="margin-bottom: 4px;">Verify your Sentinel account</h2>
      <p style="color: #666;">Click below to confirm this is your email address. This link expires in 24 hours.</p>
      <p><a href="${link}" style="display: inline-block; padding: 10px 20px; background: #3B4CE0; color: #fff; text-decoration: none; border-radius: 6px;">Verify email</a></p>
      <p style="color: #999; font-size: 12px;">If you didn't create a Sentinel account, you can ignore this email.</p>
    </div>
  `;
}

function buildResetHtml(link) {
  return `
    <div style="font-family: sans-serif; max-width: 480px;">
      <h2 style="margin-bottom: 4px;">Reset your Sentinel password</h2>
      <p style="color: #666;">Click below to set a new password. This link expires in 1 hour and can only be used once.</p>
      <p><a href="${link}" style="display: inline-block; padding: 10px 20px; background: #3B4CE0; color: #fff; text-decoration: none; border-radius: 6px;">Reset password</a></p>
      <p style="color: #999; font-size: 12px;">If you didn't request this, you can ignore this email - your password won't change.</p>
    </div>
  `;
}

// Both send functions follow the same honesty discipline as
// lib/alerting.js's sendAlert(): the Resend SDK doesn't throw on API
// errors, it resolves with { data, error }, so both a thrown exception and
// a resolved .error field are treated as failure. Never throws - the
// caller decides what a failed send means for its own flow (signup still
// succeeds either way; forgot-password always returns the same generic
// response either way).
export async function sendVerificationEmail(merchant, origin) {
  const token = generateToken();
  const expiry = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
  await prisma.merchant.update({
    where: { id: merchant.id },
    data: { verificationToken: token, verificationTokenExpiry: expiry },
  });

  const link = `${origin}/verify?token=${token}`;
  try {
    const client = getResendClient();
    const result = await client.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: merchant.email,
      subject: "Verify your Sentinel account",
      html: buildVerificationHtml(link),
    });
    if (result.error) {
      const message = result.error.message || JSON.stringify(result.error);
      console.error(`Failed to send verification email to ${merchant.email}:`, message);
      return { sent: false, error: message };
    }
    return { sent: true };
  } catch (err) {
    const message = err?.message || String(err);
    console.error(`Failed to send verification email to ${merchant.email}:`, message);
    return { sent: false, error: message };
  }
}

export async function sendPasswordResetEmail(merchant, origin) {
  const token = generateToken();
  const expiry = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await prisma.merchant.update({
    where: { id: merchant.id },
    data: { resetToken: token, resetTokenExpiry: expiry },
  });

  const link = `${origin}/reset-password?token=${token}`;
  try {
    const client = getResendClient();
    const result = await client.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: merchant.email,
      subject: "Reset your Sentinel password",
      html: buildResetHtml(link),
    });
    if (result.error) {
      const message = result.error.message || JSON.stringify(result.error);
      console.error(`Failed to send password reset email to ${merchant.email}:`, message);
      return { sent: false, error: message };
    }
    return { sent: true };
  } catch (err) {
    const message = err?.message || String(err);
    console.error(`Failed to send password reset email to ${merchant.email}:`, message);
    return { sent: false, error: message };
  }
}
