import { NextResponse } from "next/server";
import { getShop, getShopListings, isEtsyConfigured } from "@/lib/etsy-api";
import { getAccessToken } from "@/lib/etsy-tokens";
import { seasonReport } from "@/lib/season";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The calendar against the shop's listings.
 *
 * Its own route rather than a corner of the shop report: the calendar needs
 * only the listings, where the report also pages through every transaction the
 * shop has ever taken. Asking for one should not wait on the other.
 */
export async function GET() {
  if (!isEtsyConfigured()) {
    return NextResponse.json({ error: "Etsy is not configured." }, { status: 501 });
  }

  try {
    const accessToken = await getAccessToken();
    const shop = await getShop(accessToken);
    const listings = await getShopListings(accessToken, shop.shopId);

    return NextResponse.json({ seasons: seasonReport(listings) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read your listings.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
