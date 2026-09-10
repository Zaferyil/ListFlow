import { NextResponse } from "next/server";
import { getShop, getShopListings, getShopSales, isEtsyConfigured } from "@/lib/etsy-api";
import { getAccessToken } from "@/lib/etsy-tokens";
import { auditListings, buildShopReport } from "@/lib/shop-report";
import { seasonReport } from "@/lib/season";

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
    const listings = await getShopListings(accessToken, shop.shopId);

    // Only the sales need transactions_r. The audit and the favourites run on
    // listings_r, which every connection already has, so a shop that predates
    // that scope still gets everything except the money — asking it to
    // reconnect before it may read its own listings would be a toll for
    // nothing.
    let sales: Awaited<ReturnType<typeof getShopSales>> = [];
    let salesError: string | undefined;
    try {
      sales = await getShopSales(accessToken, shop.shopId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      salesError = /403|scope|insufficient/i.test(message)
        ? "Sales are missing because this app now asks for sales access and your connection predates it. Disconnect and connect again to grant it — the audit below does not need it."
        : `Sales could not be read: ${message}`;
    }

    return NextResponse.json({
      shop,
      report: buildShopReport(listings, sales),
      audit: auditListings(listings),
      // The API knows nothing about the market, but it knows the shop and the
      // calendar the US market runs on — which is what decides a seasonal
      // listing, since one published after buying starts has missed its year.
      seasons: seasonReport(listings),
      salesError,
      needsReconnect: Boolean(salesError),
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
