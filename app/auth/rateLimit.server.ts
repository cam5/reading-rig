// In-process fixed-window rate limiter. Railway runs this app as a single
// container (no replicas configured — see railway.toml), so an in-memory
// counter is a real limit, not a per-replica illusion an attacker could
// dodge by luck of which instance they hit. It resets on deploy/restart,
// same gap every other in-process cache here has; acceptable for what this
// guards (mail-bombing an inbox via POST /auth/login — see SECURITY.md),
// not a boundary with real assets behind it.
type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

// Piggybacks on traffic rather than a timer: every call has a small chance
// to sweep buckets whose window has already lapsed, so a long-running
// deploy doesn't accumulate one entry per distinct email/IP forever.
// Correctness never depends on sweep timing — an unswept expired bucket is
// just a memory cost, `hit` below already treats it as expired either way.
const SWEEP_PROBABILITY = 0.01;

function sweep(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) buckets.delete(key);
  }
}

// Returns true if `key` is still within `limit` hits per `windowMs`,
// counting this call as one of them. Each key gets its own independent
// window starting from its first hit (fixed window, not sliding) — simple,
// and close enough at this traffic scale.
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  if (Math.random() < SWEEP_PROBABILITY) sweep(now, windowMs);

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= limit) return false;

  bucket.count += 1;
  return true;
}

// Railway's edge proxies every request, appending the real client address
// to X-Forwarded-For — the connection `request` itself arrives on is always
// the proxy's own. Takes the first (left-most) entry, the original client;
// later entries are hops added by Railway's own proxy chain. Falls back to
// a fixed key rather than throwing so a header-less request (local dev,
// tests) still gets rate-limited as a single bucket instead of bypassing
// the IP limit entirely.
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  return forwarded.split(",")[0].trim();
}
