const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

// A web page can point its own hostname at 127.0.0.1 (DNS rebinding) and read
// this service as same-origin. Browsers always send the hostname they used, so
// only answer requests addressed to this machine by name.
export function isLocalHost(hostHeader) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(hostHeader || ""));
}

export function corsHeaders(origin) {
  const headers = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin"
  };
  if (origin && LOCAL_ORIGIN.test(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}
