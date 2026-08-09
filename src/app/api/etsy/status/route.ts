import { NextResponse } from "next/server";
import { getShippingProfiles, getShop, isEtsyConfigured } from "@/lib/etsy-api";
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
    return NextResponse.json({
      configured: true,
      connected: true,
      shop,
      shippingProfiles: await getShippingProfiles(accessToken, shop.shopId),
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
