import { NextResponse } from "next/server";
import { getShop, getShopListings, getShopSales, isEtsyConfigured } from "@/lib/etsy-api";
import { getAccessToken } from "@/lib/etsy-tokens";
import { auditListings, buildShopReport } from "@/lib/shop-report";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Favourites and sales per listing, plus the same SEO audit a new listing gets.
 * One read of the shop's listings answers both, and the two belong together: a
 * listing with no favourites and a twenty-word title has told you where to look.
 */
export async function GET() {
  if (!isEtsyConfigured()) {
    return NextResponse.json({ error: "Etsy is not configured." }, { status: 501 });
  }

  try {
    const accessToken = await getAccessToken();
    const shop = await getShop(accessToken);
    const [listings, sales] = await Promise.all([
      getShopListings(accessToken, shop.shopId),
      getShopSales(accessToken, shop.shopId),
    ]);

    return NextResponse.json({
      shop,
      report: buildShopReport(listings, sales),
      audit: auditListings(listings),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read your shop.";

    // Sales need transactions_r, which shops connected before this feature
    // existed never granted. Etsy answers 403, which on its own reads as a
    // broken app rather than a consent the seller can give in ten seconds.
    const needsReconnect = /403|scope|insufficient/i.test(message);
    return NextResponse.json(
      {
        error: needsReconnect
          ? "Etsy did not allow reading your sales. This app now asks for sales access, which your connection predates — disconnect and connect again to grant it."
          : message,
        needsReconnect,
      },
      { status: 502 },
    );
  }
}
