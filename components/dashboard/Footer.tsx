"use client";

import { Sparkles } from "lucide-react";
import { useBrand } from "@/components/BrandContext";
import { AUTHOR } from "@/lib/attribution";

/** Slim, theme-aware credit footer shown at the bottom of every dashboard page.
 *  Brand-driven and neutral — shows "Powered by <appName>". */
export default function Footer() {
  const brand = useBrand();
  const appName =
    process.env.NEXT_PUBLIC_APP_NAME ?? brand.appName ?? "YouTubePilot AI";

  return (
    <footer className="mt-auto border-t border-white/[0.06] px-4 sm:px-6 lg:px-8 py-5">
      <div className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-xs text-white/45">
        <Sparkles size={12} className="shrink-0 text-brand" />
        <span className="whitespace-nowrap">Powered by</span>
        <span className="whitespace-nowrap font-semibold bg-gradient-to-r from-brand to-brand-light bg-clip-text text-transparent">
          {appName}
        </span>
        <span aria-hidden className="text-white/20">·</span>
        <span className="whitespace-nowrap">
          built by{" "}
          <a
            href={AUTHOR.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-white/70 underline decoration-white/20 underline-offset-2 transition hover:text-white hover:decoration-white/50"
          >
            @{AUTHOR.handle}
          </a>
        </span>
      </div>
    </footer>
  );
}
