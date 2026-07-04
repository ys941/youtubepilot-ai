import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyPostFailed } from "@/lib/notifier";
import { publishPostToYouTubeShort } from "@/lib/youtubePublish";
import { isYouTubeConfigured, type YouTubeCreds } from "@/lib/youtube";
import { readPreferencesForBrand } from "@/lib/preferences";
import { DEFAULT_SHORT_SECONDS } from "@/lib/shortLength";
import { getBrandCredentials, resolveBrandId } from "@/lib/brands";
import { brandFromQuery, brandFromBody } from "@/lib/brandRequest";

// After a SUCCESSFUL external publish, the id-persist write must survive a
// transient DB blip — otherwise the post looks unpublished and a retry re-uploads
// it (duplicate Short). Retry a few times with a small backoff.
async function persistWithRetry(fn: () => Promise<unknown>, label: string, attempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { await fn(); return; }
    catch (err) { lastErr = err; if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
  }
  console.error(`[Post Publish] id-persist FAILED after ${attempts} attempts (${label}):`, lastErr);
  throw lastErr;
}

// ─────────────────────────────────────────────
// YouTube Short publish
// ─────────────────────────────────────────────

// Map a Post row to the YtPostInput shape expected by publishPostToYouTubeShort,
// read the user's YouTube prefs, render the post → Short MP4 → upload. Throws on failure.
async function publishYouTubeShortForPost(post: {
  id: string; type: string; title: string;
  hook?: string | null; content?: string | null; cta?: string | null;
  reelScript?: string | null; hashtags?: string[];
  carouselSlides?: unknown;
}, brandId?: string | null, creds?: YouTubeCreds): Promise<{ videoId: string; url: string; slides: number }> {
  // Per-brand YouTube settings (no brand → primary, identical to legacy readPreferences()).
  const prefs = await readPreferencesForBrand(brandId ?? null);
  const yt = prefs.youtube;
  return publishPostToYouTubeShort(
    {
      id:             post.id,
      type:           post.type,
      title:          post.title,
      hook:           post.hook ?? null,
      content:        post.content ?? null,
      cta:            post.cta ?? null,
      reelScript:     post.reelScript ?? null,
      hashtags:       post.hashtags ?? [],
      carouselSlides: (post.carouselSlides as Array<{ slide: number; headline: string; body: string }> | null) ?? null,
    },
    // Pass the FULL pacing/voiceover prefs (same defaults as the scheduler path
    // in lib/catchup.ts) — omitting them built silent, default-paced Shorts on
    // manual "Publish Now".
    {
      privacy:            yt.privacy,
      secondsPerImage:    yt.secondsPerImage,
      targetShortSeconds: yt?.targetShortSeconds ?? DEFAULT_SHORT_SECONDS,
      descriptionSuffix:  yt.descriptionSuffix,
      voiceover:          yt?.voiceover ?? false,
      voiceoverVoice:     yt?.voiceoverVoice ?? "daniel",
      burnCaptions:       yt?.burnCaptions ?? false,
    },
    // Omit creds for the primary brand → env/primary path (exact legacy behaviour).
    creds,
  );
}

// ─────────────────────────────────────────────
// ROUTE HANDLER  -  YouTube-only publish
// ─────────────────────────────────────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // Tracks the ScheduledPost(s) we atomically claimed (PENDING→FAILED "__CLAIMING__").
  // Declared at function scope so the catch block can restore them to PENDING on failure.
  // NOTE: this is an ARRAY — a single Post can have MORE THAN ONE linked PENDING
  // ScheduledPost (e.g. scheduled twice, or auto-generate + manual schedule). We must
  // claim ALL of them, otherwise the scheduler (publishOverdueScheduled) can pick up a
  // leftover PENDING SP during the slow publish and double-publish the same content.
  const claimedScheduledPostIds: string[] = [];
  try {
    const session = await getServerSession();
    const { id } = await params;

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", data: null },
        { status: 401 }
      );
    }

    // ── Optional brand override from request body / query ─────────────────────
    // Multi-brand: brand from body OR ?brand= query. Empty/omitted → primary brand.
    // (Platform is always YouTube — this product is YouTube-only.)
    let brandParam: string | null = brandFromQuery(_request);
    try {
      const body = await _request.json();
      brandParam = brandFromBody(body, brandParam);
    } catch {
      // No/invalid JSON body — keep using the query brand
    }

    // Resolve the brand once. No brand / unknown → primary id (NULL-equivalent), so
    // the per-brand reads/writes below behave EXACTLY as the legacy single-account path.
    const brandId = await resolveBrandId(brandParam);
    // Stamp the primary brand's posts with brandId=null (legacy rows use NULL == primary).
    const primaryId = await resolveBrandId(null);
    const postBrandId = brandId === primaryId ? null : brandId;
    // Build that brand's YouTube OAuth creds (undefined for primary → env/primary path).
    const brandCreds = await getBrandCredentials(brandId);
    const ytCreds: YouTubeCreds | undefined = postBrandId
      ? { clientId: brandCreds.ytClientId, clientSecret: brandCreds.ytClientSecret, refreshToken: brandCreds.ytRefreshToken }
      : undefined;

    // Fetch post and verify ownership
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post || post.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: "Post not found", data: null },
        { status: 404 }
      );
    }

    if (post.status === "PUBLISHED") {
      return NextResponse.json(
        { success: false, error: "Post is already published", data: null },
        { status: 409 }
      );
    }

    // ── Force the post platform to YouTube ────────────────────────────────────
    // This product publishes only YouTube Shorts. Persist "youtube" if the stored
    // platform is anything else so downstream reads/analytics reflect the target.
    if (post.platform !== "youtube") {
      post.platform = "youtube";
      await prisma.post.update({
        where: { id },
        data: { platform: "youtube" },
      }).catch(() => {});
    }

    // ── Stamp the resolved brand onto the Post ────────────────────────────────
    // Only write when it actually changes (postBrandId is null for the primary
    // brand, so primary/no-brand posts are left untouched → identical legacy rows).
    if (post.brandId !== postBrandId) {
      post.brandId = postBrandId;
      await prisma.post.update({ where: { id }, data: { brandId: postBrandId } }).catch(() => {});
    }

    // ── Claim lock: participate in the same atomic claim the scheduler uses ────
    // When a post has a linked PENDING ScheduledPost, the scheduler (lib/catchup.ts)
    // may pick it up at the same time as this manual publish. To prevent a
    // double-publish, atomically flip those SPs PENDING→FAILED "__CLAIMING__" the same
    // way the scheduler does. We claim ALL linked PENDING ScheduledPosts for this
    // postId (a post can legitimately have more than one). On success each publish path
    // resets them to PUBLISHED; on failure the catch block restores them to PENDING so
    // they aren't stuck on the __CLAIMING__ sentinel.
    const linkedScheduledList = await prisma.scheduledPost.findMany({
      where: { postId: id, status: "PENDING" },
      select: { id: true },
    });
    for (const sp of linkedScheduledList) {
      const claimed = await prisma.scheduledPost.updateMany({
        where: { id: sp.id, status: "PENDING" },
        data:  { status: "FAILED", error: "__CLAIMING__" },
      }).catch(() => ({ count: 0 }));
      if (claimed.count === 1) {
        claimedScheduledPostIds.push(sp.id);
      }
      // count===0 → the scheduler claimed this particular SP first; that's fine, the
      // scheduler's Guard 1 will defer to this manual publish once the Post is PUBLISHED.
    }

    // Stamp the resolved brand onto every ScheduledPost this publish claimed.
    // postBrandId is null for the primary brand → leaves legacy rows untouched.
    if (postBrandId && claimedScheduledPostIds.length > 0) {
      await prisma.scheduledPost.updateMany({
        where: { id: { in: claimedScheduledPostIds } },
        data:  { brandId: postBrandId },
      }).catch(() => {});
    }

    // ── Publish a YouTube Short ───────────────────────────────────────────────
    // Idempotency: a Short was already uploaded for this post → treat as published.
    if (post.youtubeVideoId) {
      return NextResponse.json(
        { success: false, error: "Post is already published to YouTube", data: null },
        { status: 409 }
      );
    }

    if (!isYouTubeConfigured(ytCreds)) {
      return NextResponse.json(
        {
          success: false,
          error: "YouTube is not connected. Configure YouTube OAuth credentials to publish Shorts.",
          data: null,
        },
        { status: 422 }
      );
    }

    try {
      const ytResult = await publishYouTubeShortForPost(post, brandId, ytCreds);
      const now = new Date();
      // Publish already succeeded on YouTube — persist the id with retry so a
      // transient DB blip can't drop it (which would look unpublished and cause a
      // re-upload → duplicate Short).
      let updatedPost!: Awaited<ReturnType<typeof prisma.post.update>>;
      await persistWithRetry(async () => {
        updatedPost = await prisma.post.update({
          where: { id },
          data: {
            status: "PUBLISHED",
            youtubeVideoId: ytResult.videoId,
            publishedAt: now,
          },
        });
      }, `YT post ${id}`);

      // Release ALL claimed ScheduledPosts as PUBLISHED with the resulting video id.
      if (claimedScheduledPostIds.length > 0) {
        await prisma.scheduledPost.updateMany({
          where: { id: { in: claimedScheduledPostIds } },
          data:  { status: "PUBLISHED", youtubeVideoId: ytResult.videoId, publishedAt: now, error: null },
        }).catch(() => {});
      }

      // Also cancel/clear any other PENDING or __CLAIMING__ ScheduledPost for this post
      // so the scheduler doesn't publish the same content a second time.
      await prisma.scheduledPost.updateMany({
        where: { postId: id, status: "PENDING" },
        data:  { status: "PUBLISHED", youtubeVideoId: ytResult.videoId, publishedAt: now },
      }).catch(() => {});
      await prisma.scheduledPost.updateMany({
        where: { postId: id, status: "FAILED", error: "__CLAIMING__" },
        data:  { status: "PUBLISHED", youtubeVideoId: ytResult.videoId, publishedAt: now, error: null },
      }).catch(() => {});

      // Create analytics record (starts at zero, populated later via sync).
      // Stamp brandId from the resolved post so the row is scoped to the same brand
      // (NULL for the primary brand — unchanged in single-account use).
      await prisma.analytics.upsert({
        where: { postId: id },
        create: { postId: id, brandId: (updatedPost as any).brandId } as any,
        update: {},
      });

      // Log activity
      await prisma.activityLog.create({
        data: {
          userId: session.user.id,
          action: "YOUTUBE_PUBLISHED",
          entity: "Post",
          entityId: id,
          metadata: { youtubeVideoId: ytResult.videoId, publishedAt: now.toISOString() },
        },
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        error: null,
        data: {
          post: updatedPost,
          platform: "youtube",
          youtubeVideoId: ytResult.videoId,
          youtubeUrl: ytResult.url,
          publishedAt: now,
        },
      });
    } catch (ytErr: unknown) {
      const ytMessage = ytErr instanceof Error ? ytErr.message : "YouTube publish failed";
      console.error("[Post Publish] YouTube error:", ytMessage);
      await prisma.post
        .update({ where: { id }, data: { status: "FAILED" } })
        .catch(() => {});
      // Restore ALL claimed ScheduledPosts to PENDING so none stay stuck on the sentinel.
      if (claimedScheduledPostIds.length > 0) {
        await prisma.scheduledPost.updateMany({
          where: { id: { in: claimedScheduledPostIds } },
          data:  { status: "PENDING", error: null },
        }).catch(() => {});
      }
      return NextResponse.json(
        { success: false, error: ytMessage, data: null },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[Post Publish] Error:", message);

    // Mark post as failed in DB (id was already resolved at the top of try block)
    const { id } = await params; // params is a resolved Promise  -  safe to await again
    await prisma.post
      .update({
        where: { id },
        data: { status: "FAILED" },
      })
      .catch(() => {});

    // Restore ALL claimed ScheduledPosts to PENDING so the scheduler can retry them,
    // rather than leaving any stuck on the __CLAIMING__ sentinel.
    if (claimedScheduledPostIds.length > 0) {
      await prisma.scheduledPost
        .updateMany({
          where: { id: { in: claimedScheduledPostIds } },
          data:  { status: "PENDING", error: null },
        })
        .catch(() => {});
    }

    // Send failure email notification (best-effort, rate-limited per post)
    notifyPostFailed({ postId: id, error: message }).catch(() => {});

    return NextResponse.json(
      { success: false, error: message, data: null },
      { status: 500 }
    );
  }
}
