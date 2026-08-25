import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { COOKIE_NAME } from "@/lib/sessionConstants";

const PROTECTED_PATHS = ["/dashboard", "/settings", "/demo-payment"];
const AUTH_PATHS = ["/signup", "/login"];

async function hasValidSession(request) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET));
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAuthPage = AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isProtected && !isAuthPage) {
    return NextResponse.next();
  }

  const loggedIn = await hasValidSession(request);

  if (isProtected && !loggedIn) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (isAuthPage && loggedIn) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/settings/:path*", "/demo-payment/:path*", "/signup", "/login"],
};
