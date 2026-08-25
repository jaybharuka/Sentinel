import { ingestTransaction } from "@/lib/ingestTransaction";
import { getCurrentMerchant } from "@/lib/currentMerchant";

const VALID_SCENARIOS = ["clean", "suspicious", "auto_refund"];

// Fixed demo payloads chosen so the fallback heuristic's score is
// deterministic regardless of what real data is already in the DB - each
// gets a fresh random customerId/email so repeated clicks never accumulate
// velocity/history from earlier demo runs.
function buildScenario(scenario) {
  const rand = Math.random().toString(36).slice(2, 8);
  const now = new Date();

  if (scenario === "suspicious") {
    const oddHourTimestamp = new Date(now);
    oddHourTimestamp.setHours(2, 30, 0, 0);
    return {
      txnId: `demo_suspicious_${Date.now()}_${rand}`,
      amount: 5000,
      currency: "INR",
      email: `throwaway.${rand}@mailinator.com`,
      ipCountry: "US",
      billingCountry: "IN",
      customerId: `demo_suspicious_customer_${rand}`,
      timestamp: oddHourTimestamp.toISOString(),
      isNewCustomer: true,
      previousChargebacks: 3,
    };
  }

  if (scenario === "auto_refund") {
    return {
      txnId: `demo_autorefund_${Date.now()}_${rand}`,
      amount: 500,
      currency: "INR",
      email: `flagged.${rand}@mailinator.com`,
      ipCountry: "US",
      billingCountry: "IN",
      customerId: `demo_autorefund_customer_${rand}`,
      timestamp: now.toISOString(),
      isNewCustomer: true,
      previousChargebacks: 5,
      // Real request paths only ever set this via a genuine AI scoring call
      // or the rule-based fallback (which caps at hold_for_review) - this
      // scenario is the one place a specific score is injected, purely to
      // narrate the auto_refund decision for the demo. source stays
      // "demo_simulated" below so refund execution (stage 3) never fires.
      forcedScoringOutput: {
        risk_score: 0.95,
        confidence: 0.9,
        reasons: [
          "Disposable email domain and IP/billing country mismatch on a brand-new customer",
          "5 prior chargebacks on record",
        ],
        recommended_action: "auto_refund",
      },
    };
  }

  // "clean"
  return {
    txnId: `demo_clean_${Date.now()}_${rand}`,
    amount: 1200,
    currency: "INR",
    email: `regular.${rand}@gmail.com`,
    ipCountry: "IN",
    billingCountry: "IN",
    customerId: `demo_clean_customer_${rand}`,
    timestamp: new Date(now.setHours(14, 0, 0, 0)).toISOString(),
    isNewCustomer: false,
    previousChargebacks: 0,
  };
}

export async function POST(request) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const scenario = VALID_SCENARIOS.includes(body.scenario) ? body.scenario : "clean";
  const event = {
    ...buildScenario(scenario),
    forceFallback: true,
    source: "demo_simulated",
    merchantId: merchant.id,
  };

  const { saved, scoringError } = await ingestTransaction(event);

  return Response.json({
    scenario,
    scoringAttempted: true,
    scoringError,
    fallbackReasons: saved.reasons,
    riskScore: saved.riskScore,
    confidence: saved.confidence,
    policyDecision: saved.policyDecision,
    actionTaken: saved.actionTaken,
    refundExecuted: saved.refundExecuted,
    transaction: saved,
  });
}
