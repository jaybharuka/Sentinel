import { prisma } from "@/lib/prisma";
import { getCurrentMerchant } from "@/lib/currentMerchant";

// Revokes one session - the actual mechanism, not a client-side gesture.
// Deleting the row makes getSessionMerchantId() reject that session's JWT
// on its very next request, from wherever that device/tab happens to be.
export async function DELETE(request, { params }) {
  const merchant = await getCurrentMerchant();
  if (!merchant) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // Scoped to this merchant - never lets one merchant revoke a session
  // that isn't theirs, even if they guess a valid session id.
  const { count } = await prisma.session.deleteMany({
    where: { id, merchantId: merchant.id },
  });
  if (count === 0) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json({ revoked: true });
}
