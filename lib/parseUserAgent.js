// Minimal, good-enough browser/OS label for "Active sessions" - not a real
// UA-parsing library (no new dependency for what's ultimately decoration),
// just enough substring matching to turn a raw User-Agent string into
// something a merchant can actually recognize at a glance.
export function parseUserAgent(userAgent) {
  if (!userAgent) return "Unknown device";

  let browser = "Unknown browser";
  if (/Edg\//.test(userAgent)) browser = "Edge";
  else if (/Chrome\//.test(userAgent)) browser = "Chrome";
  else if (/Firefox\//.test(userAgent)) browser = "Firefox";
  else if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) browser = "Safari";

  // iPhone/iPad checked before "Mac OS X" - iOS user agents embed
  // "like Mac OS X" for legacy compatibility, so the substring match
  // would otherwise misreport every iPhone/iPad as macOS.
  let os = "";
  if (/iPhone|iPad/.test(userAgent)) os = "iOS";
  else if (/Windows/.test(userAgent)) os = "Windows";
  else if (/Mac OS X/.test(userAgent)) os = "macOS";
  else if (/Android/.test(userAgent)) os = "Android";
  else if (/Linux/.test(userAgent)) os = "Linux";

  return os ? `${browser} on ${os}` : browser;
}
