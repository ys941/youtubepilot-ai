"use client";

import { Sparkles } from "lucide-react";
import { useBrand } from "@/components/BrandContext";

/** Slim, theme-aware credit footer shown at the bottom of every dashboard page.
 *  Brand-driven and neutral — shows "Powered by <appName>". */
export default function Footer() {
  const brand = useBrand();
  const appName =
    process.env.NEXT_PUBLIC_APP_NAME ?? brand.appName ?? "YouTubePilot AI";

  return (
    <footer className="mt-auto border-t border-white/[0.06] px-4 sm:px-6 lg:px-8 py-5">
      <div className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-xs text-white/45">
        <Sparkles size={12} className="shrink-0 text-brand" />
        <span className="whitespace-nowrap">Powered by</span>
        <span className="whitespace-nowrap font-semibold bg-gradient-to-r from-brand to-brand-light bg-clip-text text-transparent">
          {appName}
        </span>
      </div>
    </footer>
  );
}
