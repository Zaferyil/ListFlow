import { NextResponse } from "next/server";
import { getShop, getShopListings, getShopSales, isEtsyConfigured } from "@/lib/etsy-api";
import { getAccessToken } from "@/lib/etsy-tokens";
import { auditListings, priceBandOf } from "@/lib/shop-report";
import { buildWorklist, seasonGaps } from "@/lib/worklist";
import { competingGroups } from "@/lib/cannibalization";

export const runtime = "nodejs";
export const maxDuration = 120;

/** What to work on next, drawn from the listings, the audit and the calendar. */
export async function GET() {
  if (!isEtsyConfigured()) {
    return NextResponse.json({ error: "Etsy is not configured." }, { status: 501 });
  }

  try {
    const accessToken = await getAccessToken();
    const shop = await getShop(accessToken);
    const listings = await getShopListings(accessToken, shop.shopId);

    // Which listings sell is what keeps them out of the queue, so it is worth
    // the extra call — but a shop that has not granted sales access should
    // still get a worklist, with a word about what is missing from it.
    let sold = new Map<number, number>();
    let salesError: string | undefined;
    try {
      const sales = await getShopSales(accessToken, shop.shopId);
      for (const sale of sales) {
        if (sale.paidAt === 0) continue;
        sold.set(sale.listingId, (sold.get(sale.listingId) ?? 0) + sale.quantity);
      }
    } catch {
      salesError =
        "Sales access was refused, so listings that have already sold are not being kept out of this queue. Reconnect to Etsy to grant it.";
    }

    const findings = new Map(
      auditListings(listings).map((entry) => [entry.listingId, entry.warnings.length]),
    );

    const candidates = listings.map((listing) => ({
      listingId: listing.listingId,
      title: listing.title,
      favorites: listing.favorites,
      unitsSold: sold.get(listing.listingId) ?? 0,
      imageCount: listing.imageCount,
      createdAt: listing.createdAt,
      findings: findings.get(listing.listingId) ?? 0,
      price: listing.price,
    }));

    // What this shop's buyers have actually paid, which is a better guide to
    // what they will pay than any general advice about pricing. Absent when
    // sales could not be read — a band drawn from no sales is a made-up one.
    const band = priceBandOf(candidates);

    return NextResponse.json({
      worklist: buildWorklist(candidates, new Date(), band),
      priceBand: band,
      gaps: seasonGaps(listings.map((listing) => listing.title)),
      // Run off the listings already fetched above, so the whole shop is
      // checked against itself without a second read of it.
      competing: competingGroups(
        listings.map((listing) => ({
          listingId: listing.listingId,
          title: listing.title,
          tags: listing.tags,
          unitsSold: sold.get(listing.listingId) ?? 0,
          favorites: listing.favorites,
          imageCount: listing.imageCount,
        })),
      ),
      salesError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read your shop.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
