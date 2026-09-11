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

import { inspectListing, type ListingWarning } from "./etsy";

export interface ShopListingSummary {
  listingId: number;
  title: string;
  favorites: number;
  imageCount: number;
  createdAt: number;
}

/**
 * Photos Etsy's own guidance asks for. Search results are a grid of images:
 * the title decides whether a listing is matched, the first photo decides
 * whether it is opened, and the rest decide whether it is believed.
 */
const WANTED_IMAGES = 5;

/** Long enough live that silence is a verdict rather than a wait. */
const SETTLED_DAYS = 60;

function ageInDays(createdAt: number): number {
  if (!createdAt) return 0;
  return Math.max(0, Math.floor((Date.now() / 1000 - createdAt) / 86400));
}

export interface AuditedListing {
  listingId: number;
  title: string;
  warnings: ListingWarning[];
  /** When Etsy last saw this listing change, in epoch seconds. */
  updatedAt: number;
}

/**
 * What a listing's own record says about it, beyond its wording.
 *
 * The copy checks ask whether a listing can be found. These ask whether it is
 * worth finding — enough photos to be opened, and long enough live that having
 * drawn nobody at all is a result rather than a wait. Ordered first because
 * neither is fixed by a rewrite.
 */
function listingHealth(listing: {
  imageCount: number;
  favorites: number;
  createdAt: number;
}): ListingWarning[] {
  const warnings: ListingWarning[] = [];
  const age = ageInDays(listing.createdAt);

  if (listing.imageCount < WANTED_IMAGES) {
    warnings.push({
      field: "title",
      message: `Only ${listing.imageCount} photo${listing.imageCount === 1 ? "" : "s"}. Etsy search is a grid of images — the wording decides whether you are matched, the first photo decides whether you are opened. Aim for ${WANTED_IMAGES} or more.`,
    });
  }

  if (age >= SETTLED_DAYS && listing.favorites === 0) {
    warnings.push({
      field: "title",
      message: `Live ${age} days with no favourites at all. That is long enough to be a verdict: nobody is reaching this listing, or nobody who reaches it wants it.`,
    });
  }

  return warnings;
}

/**
 * Runs the live listings past the same rules a freshly generated one is held
 * to, and reports only. Nothing here writes: a listing already earning its
 * place is not obviously improved by a rewrite — Etsy weighs a listing's own
 * history — so which of these to act on is the seller's call, one at a time.
 *
 * Required keywords are not checked. Those are a property of the blank a
 * listing was written for, and an existing listing does not say which blank
 * that was; flagging every one for a missing brand term would be noise.
 */
export function auditListings(
  listings: {
    listingId: number;
    title: string;
    description: string;
    tags: string[];
    imageCount: number;
    favorites: number;
    createdAt: number;
    updatedAt: number;
  }[],
): AuditedListing[] {
  return listings
    .map((listing) => ({
      listingId: listing.listingId,
      title: listing.title,
      updatedAt: listing.updatedAt,
      warnings: listingHealth(listing).concat(inspectListing({
        title: listing.title,
        description: listing.description,
        tags: listing.tags,
        // Not read for this audit; the checks that use them are about a listing
        // being written, not one already live.
        materials: [],
        category: "",
        attributes: "",
        notes: "",
      })),
    }))
    .filter((entry) => entry.warnings.length > 0)
    .sort((a, b) => b.warnings.length - a.warnings.length);
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
  imageCount: number;
  /** Days live. Zero when Etsy gave no creation date. */
  ageDays: number;
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
      imageCount: listing.imageCount,
      ageDays: ageInDays(listing.createdAt),
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
    // Every figure here is zero, so ordering by revenue says nothing. Oldest
    // first: a listing that has been live for months without a single
    // favourite has been answered, where last week's has not been asked yet.
    unnoticed: performance
      .filter((entry) => entry.unitsSold === 0 && entry.favorites === 0)
      .sort((a, b) => b.ageDays - a.ageDays),
  };
}
