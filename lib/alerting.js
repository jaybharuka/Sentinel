import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

// Resend sandbox sender - works with zero DNS/domain setup, but Resend
// restricts it to only deliver to the email address the sending account
// itself signed up with. A verified custom domain would lift that
// restriction; out of scope for this hackathon build.
const FROM_ADDRESS = "Sentinel Alerts <onboarding@resend.dev>";

let resendClient = null;
function getClient() {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  resendClient = new Resend(apiKey);
  return resendClient;
}

function buildHtml({ transaction, topReason }) {
  return `
    <div style="font-family: sans-serif; max-width: 480px;">
      <h2 style="margin-bottom: 4px;">Sentinel alert: ${transaction.policyDecision}</h2>
      <p style="color: #666; margin-top: 0;">Transaction ${transaction.txnId}</p>
      <table style="border-collapse: collapse; width: 100%;">
        <tr><td style="padding: 4px 0; color: #666;">Amount</td><td style="padding: 4px 0;">₹${transaction.amount}</td></tr>
        <tr><td style="padding: 4px 0; color: #666;">Decision</td><td style="padding: 4px 0;">${transaction.policyDecision}</td></tr>
        <tr><td style="padding: 4px 0; color: #666;">Risk score</td><td style="padding: 4px 0;">${transaction.riskScore?.toFixed(2) ?? "—"}</td></tr>
        <tr><td style="padding: 4px 0; color: #666;">Top reason</td><td style="padding: 4px 0;">${topReason}</td></tr>
      </table>
    </div>
  `;
}

/**
 * Sends a real alert email via Resend and always persists an Alert row -
 * on send failure (bad key, rate limit, sandbox recipient restriction,
 * etc.) the failure is logged and recorded on the row (emailSent: false,
 * emailError), never thrown, so a broken email provider can never take
 * down the ingest pipeline that already successfully saved the transaction.
 */
export async function sendAlert(transaction, settings) {
  // reasons[0] is often the generic "Gemini unavailable" fallback notice
  // rather than an actual signal - skip boilerplate lines so the alert
  // leads with something specific to this transaction.
  const topReason =
    (transaction.reasons || []).find(
      (r) => !r.startsWith("⚠️") && !r.startsWith("Fallback recommended") && !r.startsWith("Gemini recommended")
    ) || "no reason recorded";
  const subject = `[Sentinel] ${transaction.policyDecision} — ${transaction.txnId} (₹${transaction.amount})`;
  const body =
    `Transaction: ${transaction.txnId}\n` +
    `Amount: ₹${transaction.amount}\n` +
    `Decision: ${transaction.policyDecision}\n` +
    `Risk score: ${transaction.riskScore?.toFixed(2) ?? "—"}\n` +
    `Top reason: ${topReason}`;

  let recipient = settings.alertEmail;
  if (!recipient) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: transaction.merchantId },
      select: { email: true },
    });
    recipient = merchant?.email || null;
  }

  let emailSent = false;
  let emailError = null;

  if (!recipient) {
    emailError = "No recipient email available";
  } else {
    try {
      const client = getClient();
      // The Resend SDK does not throw on API errors - it resolves with
      // { data, error }, so a successful await alone doesn't mean the
      // send succeeded. Both branches (thrown exception, and a resolved
      // .error field) must be treated as failure.
      const result = await client.emails.send({
        from: FROM_ADDRESS,
        to: recipient,
        subject,
        html: buildHtml({ transaction, topReason }),
      });
      if (result.error) {
        emailError = result.error.message || JSON.stringify(result.error);
        console.error(`Failed to send alert email to ${recipient}:`, emailError);
      } else {
        emailSent = true;
      }
    } catch (err) {
      emailError = err?.message || String(err);
      console.error(`Failed to send alert email to ${recipient}:`, emailError);
    }
  }

  console.log(
    `\n=== ALERT ${emailSent ? "sent" : "NOT sent"} ===\nTo: ${recipient}\n${body}\n${emailError ? `Error: ${emailError}\n` : ""}===========================\n`
  );

  return prisma.alert.create({
    data: {
      merchantId: transaction.merchantId,
      transactionId: transaction.id,
      sentTo: recipient || "unknown",
      subject,
      body,
      emailSent,
      emailError,
    },
  });
}
