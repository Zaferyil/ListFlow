import type { MetadataRoute } from "next";

/**
 * What a phone reads when the app is added to the home screen: the name under
 * the icon, the icon itself, and standalone display so it opens without the
 * browser's address bar.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ListFlow",
    short_name: "ListFlow",
    description: "Etsy listings from a design file or a Google Sheet.",
    start_url: "/",
    display: "standalone",
    // Matches the app's dark background, so the splash screen does not flash
    // white before the page paints.
    background_color: "#131120",
    theme_color: "#6c4bd8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Android crops an icon to its own shape; this one has the room for it.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
