import type { MetadataRoute } from "next";

// Built once at build time (required for the static demo export; the manifest
// only reads env anyway).
export const dynamic = "force-static";

// Served under a sub-path in the demo build; empty for a normal install.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME ?? process.env.BRAND_NAME ?? "YouTubePilot AI";
const SHORT_NAME = APP_NAME.split(/\s+/)[0] || APP_NAME;

// PWA manifest — Next serves this at /manifest.webmanifest and auto-links it.
// Enables "Install app" (Chrome/Edge) and "Add to Home Screen" (Safari) as a
// standalone web app. Brand-driven and neutral.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: SHORT_NAME,
    description: "AI-powered YouTube Shorts automation",
    id: `${BASE}/`,
    start_url: `${BASE}/`,
    scope: `${BASE}/`,
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0A0A0F",
    theme_color: "#0A0A0F",
    categories: ["productivity", "business"],
    icons: [
      { src: `${BASE}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${BASE}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${BASE}/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
