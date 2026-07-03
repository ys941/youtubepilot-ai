import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishOverdueScheduled } from "@/lib/catchup";
import { notifySystemError } from "@/lib/notifier";

export const dynamic = "force-dynamic";

// Debounce: don't publish more than once per 20 seconds from this endpoint.
let _lastCheckAt: Date | null = null;
const SCHEDULER_CHECK_INTERVAL_MS = 20_000;

/**
 * Same-site guard for this state-changing GET. The dashboard calls it via fetch
 * (same-origin), so a cross-site page must not be able to trigger a publish.
 * Accept the request only when it is provably same-site:
 *   • Sec-Fetch-Site is "same-origin" / "same-site" / "none" (direct nav), OR
 *   • the Origin/Referer host matches the request host.
 * Reject everything else with 403.
 */
function isSameSite(request: NextRequest): boolean {
  const secSite = request.headers.get("sec-fetch-site");
  if (secSite) return secSite === "same-origin" || secSite === "same-site" || secSite === "none";
  const host = request.headers.get("host");
  const src  = request.headers.get("origin") || request.headers.get("referer");
  if (!src) return false; // no Origin/Referer and no Sec-Fetch-Site → treat as cross-site
  try {
    return new URL(src).host === host;
  } catch {
    return false;
  }
}

/**
 * GET /api/scheduler/check
 * Called by the dashboard layout every 30 seconds.
 * Publishes any PENDING scheduled posts whose scheduledFor time has passed.
 * This is separate from runCatchup() so it runs on a tight loop without
 * the 5-minute full-catchup debounce.
 */
export async function GET(request: NextRequest) {
  if (!isSameSite(request)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();

  if (_lastCheckAt && now.getTime() - _lastCheckAt.getTime() < SCHEDULER_CHECK_INTERVAL_MS) {
    return NextResponse.json({ success: true, skipped: true });
  }
  _lastCheckAt = now;

  try {
    const errors: string[] = [];

    // Quick peek  -  skip the expensive publishOverdueScheduled if nothing is due
    const dueCount = await prisma.scheduledPost.count({
      where: { status: "PENDING", scheduledFor: { lte: now } },
    });

    if (dueCount === 0) {
      return NextResponse.json({ success: true, published: 0, failed: 0 });
    }

    // YouTube-only: the catchup publisher runs the YouTube branch regardless;
    // pass empty legacy-overload args.
    const { published, failed } = await publishOverdueScheduled(errors, "", "");
    return NextResponse.json({ success: true, published, failed, errors });
  } catch (err: any) {
    const msg = err?.message ?? "Scheduler check failed";
    console.error("[/api/scheduler/check] Error:", msg);
    notifySystemError({
      title:   "Scheduler Check Crashed",
      detail:  msg,
      rateKey: "scheduler_check_crash",
    }).catch(() => {});
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

