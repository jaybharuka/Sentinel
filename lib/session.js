import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { COOKIE_NAME, SESSION_DURATION_SECONDS } from "@/lib/sessionConstants";

// Session choice for this hackathon build: a signed JWT (jose - edge and
// Node compatible, no native deps) whose payload now carries a real
// server-side Session row's id alongside merchantId - the JWT signature
// alone only proves "this token was legitimately issued at some point," it
// says nothing about whether that specific session has since been logged
// out from another device or revoked from Settings. Every Node-side auth
// check (getSessionMerchantId, below - ultimately every getCurrentMerchant()
// call) confirms the referenced Session row still exists and hasn't
// expired before trusting the token. middleware.js still only verifies the
// JWT's signature/expiry at the edge, since Prisma can't run there - same
// architectural split it already had for "does this merchant row still
// exist," not a new gap this introduces.
function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

// Real DB writes on every single authenticated request would be wasteful -
// lastUsedAt only actually gets written if it's been at least this long
// since the last write. The revocation check itself (does the Session row
// still exist/is it expired) still runs on every request regardless - this
// only throttles the "touch" write, not the check.
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export async function createSessionToken(merchantId, sessionId) {
  return new SignJWT({ merchantId, sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (!payload.merchantId || !payload.sessionId) return null;
    return { merchantId: String(payload.merchantId), sessionId: String(payload.sessionId) };
  } catch {
    return null;
  }
}

// Creates the real Session row first, then signs a JWT referencing it -
// login/signup call this with the request's User-Agent header so "Active
// sessions" in Settings has something human-readable to show.
export async function setSessionCookie(merchantId, userAgent) {
  const session = await prisma.session.create({
    data: {
      merchantId,
      userAgent: userAgent || null,
      expiresAt: new Date(Date.now() + SESSION_DURATION_SECONDS * 1000),
    },
  });
  const token = await createSessionToken(merchantId, session.id);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

// Deletes the Session row this cookie actually points at - this is what
// makes logout real, not just a client-side cookie clear. A copy of the
// JWT taken before this point (e.g. by devtools, or a proxy) can never
// authenticate again after this, since getSessionMerchantId() below checks
// the row exists on every request.
export async function clearSessionCookie() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    const parsed = await verifySessionToken(token);
    if (parsed) {
      await prisma.session.delete({ where: { id: parsed.sessionId } }).catch(() => {});
    }
  }
  store.delete(COOKIE_NAME);
}

export async function getCurrentSessionId() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const parsed = await verifySessionToken(token);
  return parsed?.sessionId || null;
}

export async function getSessionMerchantId() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const parsed = await verifySessionToken(token);
  if (!parsed) return null;

  const session = await prisma.session.findUnique({ where: { id: parsed.sessionId } });
  if (!session || session.expiresAt < new Date()) return null;

  if (Date.now() - session.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  return parsed.merchantId;
}
