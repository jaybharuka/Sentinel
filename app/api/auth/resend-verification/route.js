import { getCurrentMerchant } from "@/lib/currentMerchant";
import { sendVerificationEmail } from "@/lib/authEmails";
import { checkResendCooldown } from "@/lib/resendVerificationLimit";

export async function POST(request) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (merchant.emailVerified) {
    return Response.json({ error: "This account is already verified." }, { status: 400 });
  }

  const cooldown = checkResendCooldown(merchant.id);
  if (!cooldown.allowed) {
    return Response.json(
      { error: `Please wait ${cooldown.retryAfterSeconds}s before requesting another email.` },
      { status: 429 }
    );
  }

  const origin = request.headers.get("origin") || new URL(request.url).origin;
  const result = await sendVerificationEmail(merchant, origin);
  if (!result.sent) {
    return Response.json({ error: "Could not send verification email. Try again shortly." }, { status: 502 });
  }

  return Response.json({ sent: true });
}
