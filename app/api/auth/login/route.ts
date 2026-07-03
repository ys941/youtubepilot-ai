import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

// ── Per-IP brute-force limiter (in-memory) ────────────────────────────────────
// Max 8 failed attempts per rolling 10-minute window per client IP → 429. A
// successful login clears the counter. In-memory only (best-effort; resets on
// process restart), which is sufficient to blunt online key-guessing.
const MAX_FAILS   = 8;
const WINDOW_MS   = 10 * 60 * 1000;
const _attempts = new Map<string, { count: number; first: number }>();

function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function isBlocked(ip: string): boolean {
  const rec = _attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { _attempts.delete(ip); return false; }
  return rec.count >= MAX_FAILS;
}

function recordFail(ip: string): void {
  const now = Date.now();
  const rec = _attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) { _attempts.set(ip, { count: 1, first: now }); return; }
  rec.count += 1;
}

export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    if (isBlocked(ip)) {
      return NextResponse.json(
        { error: "Too many failed attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(WINDOW_MS / 1000)) } },
      );
    }

    const { key } = await request.json();

    const appKey = process.env.APP_ACCESS_KEY;
    if (!appKey) {
      return NextResponse.json({ error: "Server misconfiguration: APP_ACCESS_KEY not set." }, { status: 500 });
    }

    // Constant-time comparison to prevent timing attacks
    if (!key || key.length !== appKey.length || !constantTimeEqual(key, appKey)) {
      recordFail(ip);
      // Always wait a short time to prevent timing-based key enumeration
      await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
      return NextResponse.json({ error: "Invalid access key." }, { status: 401 });
    }

    // Success → clear this IP's failure counter.
    _attempts.delete(ip);

    const token = await createSessionToken();
    const res   = NextResponse.json({ success: true });

    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   SESSION_MAX_AGE,
      path:     "/",
    });

    return res;
  } catch (err) {
    console.error("[Login] Error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
