// Split out from lib/session.js (which imports next/headers - disallowed
// inside middleware.js) so middleware can share this constant safely.
export const COOKIE_NAME = "sentinel_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days
