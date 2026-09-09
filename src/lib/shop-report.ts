/**
 * What the shop's own numbers say about its listings.
 *
 * Etsy's v3 API carries favourites and sales but no views, visits or traffic
 * sources — those live only in the seller dashboard. So this cannot say what
 * was looked at, only what was wanted (favourited) and what was bought. That
 * pairing still answers the question worth asking of a print-on-demand shop:
 * which designs earn their listing fee, and which are being seen and passed
 * over.
 */

export interface ShopListingSummary {
  listingId: number;
  title: string;
  favorites: number;
}

export interface SaleLine {
  listingId: number;
  quantity: number;
  price: number;
  currency: string;
  paidAt: number;
}

export interface ListingPerformance {
  listingId: number;
  title: string;
  favorites: number;
  unitsSold: number;
  revenue: number;
}

export interface ShopReport {
  currency: string;
  totalRevenue: number;
  unitsSold: number;
  /** Live listings the shop has, whether or not they ever sold. */
  listingCount: number;
  /** Every live listing, best earner first. */
  listings: ListingPerformance[];
  /** Wanted but never bought: favourited, no sale. */
  favoritedNeverSold: ListingPerformance[];
  /** Neither favourited nor sold — nothing is reaching these at all. */
  unnoticed: ListingPerformance[];
}

/** Favourites worth calling interest rather than noise. */
const INTEREST_THRESHOLD = 1;

export function buildShopReport(
  listings: ShopListingSummary[],
  sales: SaleLine[],
): ShopReport {
  const sold = new Map<number, { units: number; revenue: number }>();
  let currency = "USD";

  for (const sale of sales) {
    // An unpaid order is not a sale yet, and counting it would overstate every
    // figure below it.
    if (sale.paidAt === 0) continue;

    if (sale.currency) currency = sale.currency;
    const running = sold.get(sale.listingId) ?? { units: 0, revenue: 0 };
    running.units += sale.quantity;
    running.revenue += sale.quantity * sale.price;
    sold.set(sale.listingId, running);
  }

  const performance: ListingPerformance[] = listings.map((listing) => {
    const result = sold.get(listing.listingId);
    return {
      listingId: listing.listingId,
      title: listing.title,
      favorites: listing.favorites,
      unitsSold: result?.units ?? 0,
      revenue: result?.revenue ?? 0,
    };
  });

  performance.sort(
    (a, b) => b.revenue - a.revenue || b.unitsSold - a.unitsSold || b.favorites - a.favorites,
  );

  return {
    currency,
    // Totalled from the sales themselves, so a listing since taken down still
    // counts towards what the shop earned.
    totalRevenue: [...sold.values()].reduce((sum, entry) => sum + entry.revenue, 0),
    unitsSold: [...sold.values()].reduce((sum, entry) => sum + entry.units, 0),
    listingCount: listings.length,
    listings: performance,
    favoritedNeverSold: performance
      .filter((entry) => entry.unitsSold === 0 && entry.favorites >= INTEREST_THRESHOLD)
      .sort((a, b) => b.favorites - a.favorites),
    unnoticed: performance.filter((entry) => entry.unitsSold === 0 && entry.favorites === 0),
  };
}
