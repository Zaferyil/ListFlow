import { NextResponse } from "next/server";
import { getShop, getShopListings, isEtsyConfigured } from "@/lib/etsy-api";
import { getAccessToken } from "@/lib/etsy-tokens";

export const runtime = "nodejs";

/**
 * The shop's live listings, so the panel can tell the seller when a new listing
 * would compete with one they already have. Titles and tags only — nothing here
 * is written back.
 */
export async function GET() {
  if (!isEtsyConfigured()) {
    return NextResponse.json({ listings: [] });
  }

  try {
    const accessToken = await getAccessToken();
    const shop = await getShop(accessToken);
    return NextResponse.json({ listings: await getShopListings(accessToken, shop.shopId) });
  } catch (error) {
    // A shop with nothing listed yet, or a lapsed token, should not stop the
    // seller publishing — the check is an extra, not a gate.
    const message = error instanceof Error ? error.message : "Could not read your listings.";
    return NextResponse.json({ listings: [], error: message });
  }
}
