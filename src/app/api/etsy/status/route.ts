import { NextResponse } from "next/server";
import {
  getProcessingProfiles,
  getShippingProfiles,
  getShop,
  isEtsyConfigured,
  originOf,
  redirectUri,
} from "@/lib/etsy-api";
import { disconnect, getAccessToken, isConnected } from "@/lib/etsy-tokens";

export const runtime = "nodejs";

/** Reports whether we can reach the shop, and returns what publishing needs. */
export async function GET(request: Request) {
  // The address Etsy has to have registered. It is derived from where the app
  // is served, so one repo running as several sites sends a different one from
  // each — and Etsy refuses the whole handshake over a character of
  // difference, saying only that the URL is not permitted. Reported here so
  // the seller can copy the exact string rather than decode it out of an
  // address bar.
  const callbackUrl = isEtsyConfigured() ? redirectUri(originOf(request)) : undefined;

  if (!isEtsyConfigured()) {
    return NextResponse.json({ configured: false, connected: false });
  }
  if (!(await isConnected())) {
    return NextResponse.json({ configured: true, connected: false, callbackUrl });
  }

  try {
    const accessToken = await getAccessToken();
    const shop = await getShop(accessToken);
    const [shippingProfiles, processingProfiles] = await Promise.all([
      getShippingProfiles(accessToken, shop.shopId),
      getProcessingProfiles(accessToken, shop.shopId),
    ]);

    return NextResponse.json({
      configured: true,
      connected: true,
      callbackUrl,
      shop,
      shippingProfiles,
      processingProfiles,
    });
  } catch (error) {
    return NextResponse.json({
      configured: true,
      connected: false,
      callbackUrl,
      error: error instanceof Error ? error.message : "Could not reach Etsy.",
    });
  }
}

export async function DELETE() {
  await disconnect();
  return NextResponse.json({ connected: false });
}
