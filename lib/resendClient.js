import { Resend } from "resend";

// Resend sandbox sender - works with zero DNS/domain setup, but Resend
// restricts it to only deliver to the email address the sending account
// itself signed up with. A verified custom domain would lift that
// restriction; out of scope for this hackathon build. Shared by every
// outbound email in the app (merchant alerts, verification, password
// reset) so there's one place that knows the sender identity.
export const RESEND_FROM_ADDRESS = "Sentinel Alerts <onboarding@resend.dev>";

let resendClient = null;
export function getResendClient() {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  resendClient = new Resend(apiKey);
  return resendClient;
}
