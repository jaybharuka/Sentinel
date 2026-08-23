import { prisma } from "@/lib/prisma";

const VALID_DECISIONS = ["allow", "hold_for_review", "auto_refund"];

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10) || 20));

  const policyDecision = searchParams.get("policyDecision");
  const usedFallbackParam = searchParams.get("usedFallback");

  const where = {};
  if (VALID_DECISIONS.includes(policyDecision)) {
    where.policyDecision = policyDecision;
  }
  if (usedFallbackParam === "true" || usedFallbackParam === "false") {
    where.usedFallback = usedFallbackParam === "true";
  }

  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return Response.json({ total, page, pageSize, rows });
}
