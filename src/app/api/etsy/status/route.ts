import { NextResponse } from "next/server";
import {
  getProcessingProfiles,
  getShippingProfiles,
  getShop,
  isEtsyConfigured,
} from "@/lib/etsy-api";
import { disconnect, getAccessToken, isConnected } from "@/lib/etsy-tokens";

export const runtime = "nodejs";

/** Reports whether we can reach the shop, and returns what publishing needs. */
export async function GET() {
  if (!isEtsyConfigured()) {
    return NextResponse.json({ configured: false, connected: false });
  }
  if (!(await isConnected())) {
    return NextResponse.json({ configured: true, connected: false });
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
      shop,
      shippingProfiles,
      processingProfiles,
    });
  } catch (error) {
    return NextResponse.json({
      configured: true,
      connected: false,
      error: error instanceof Error ? error.message : "Could not reach Etsy.",
    });
  }
}

export async function DELETE() {
  await disconnect();
  return NextResponse.json({ connected: false });
}
