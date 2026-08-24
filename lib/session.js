import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { COOKIE_NAME, SESSION_DURATION_SECONDS } from "@/lib/sessionConstants";

// Session choice for this hackathon build: a signed JWT (jose - edge and
// Node compatible, no native deps) in an httpOnly cookie, instead of a
// full auth framework like NextAuth. NextAuth's provider/adapter setup
// buys nothing here - there's exactly one credential type (email/password
// against our own Merchant table) and one session need (know which
// merchant is calling). jose gives real signature verification (unlike a
// bare unsigned cookie) and works in Next's edge middleware, which a
// Node-only JWT library (jsonwebtoken) would not.
function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(merchantId) {
  return new SignJWT({ merchantId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload.merchantId ? String(payload.merchantId) : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(merchantId) {
  const token = await createSessionToken(merchantId);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSessionMerchantId() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
