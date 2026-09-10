/**
 * The US shopping calendar, and whether the shop is ready for what is coming.
 *
 * Etsy's API carries nothing about the market — no search volume, no trends,
 * no popular terms; it can only ever describe your own shop. So this does not
 * claim to know what is selling on Etsy. What it does know is the calendar the
 * US market runs on and what the shop has listed against it, which is the
 * question that actually decides a seasonal listing: was it live early enough.
 *
 * Timing is the whole point. A listing needs weeks in the index before it
 * ranks — in this shop the newest listing to have sold anything was already two
 * months old — so a Christmas design published in November has missed the
 * season it was made for.
 */

export interface Occasion {
  name: string;
  /** Lower-case terms that identify a listing as belonging to this occasion. */
  keywords: string[];
  /** The date it falls on in a given year. */
  date: (year: number) => Date;
  /** Days before the date when buyers start searching. */
  buyingOpensDays: number;
  /** Days before the date when buying effectively stops — shipping runs out. */
  buyingClosesDays: number;
  /** Days before the date a listing should already be live to rank in time. */
  listByDays: number;
}

const on = (month: number, day: number) => (year: number) => new Date(Date.UTC(year, month - 1, day));

/** The nth given weekday of a month, e.g. the fourth Thursday of November. */
function nthWeekday(month: number, weekday: number, nth: number) {
  return (year: number) => {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const shift = (weekday - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(year, month - 1, 1 + shift + (nth - 1) * 7));
  };
}

/** Anonymous Gregorian computus — Easter moves, and a lot of spring sells off it. */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * The occasions a US print-on-demand shop sells against.
 *
 * Windows are the buying pattern, not the date itself: Christmas shopping on
 * Etsy runs from mid-October and stops well before the 25th, when shipping can
 * no longer make it.
 */
export const OCCASIONS: Occasion[] = [
  {
    name: "Halloween",
    keywords: ["halloween", "spooky", "ghost", "pumpkin", "witch", "boo"],
    date: on(10, 31),
    buyingOpensDays: 45,
    buyingClosesDays: 6,
    listByDays: 90,
  },
  {
    name: "Thanksgiving",
    keywords: ["thanksgiving", "turkey", "grateful", "thankful", "fall harvest"],
    date: nthWeekday(11, 4, 4),
    buyingOpensDays: 40,
    buyingClosesDays: 7,
    listByDays: 90,
  },
  {
    name: "Christmas",
    keywords: ["christmas", "xmas", "santa", "reindeer", "elf", "merry"],
    date: on(12, 25),
    buyingOpensDays: 70,
    buyingClosesDays: 10,
    listByDays: 120,
  },
  {
    name: "New Year",
    keywords: ["new year", "nye", "resolution", "2027", "2028"],
    date: on(1, 1),
    buyingOpensDays: 30,
    buyingClosesDays: 2,
    listByDays: 75,
  },
  {
    name: "Valentine's Day",
    keywords: ["valentine", "galentine", "love you", "heart day", "cupid"],
    date: on(2, 14),
    buyingOpensDays: 40,
    buyingClosesDays: 6,
    listByDays: 90,
  },
  {
    name: "St. Patrick's Day",
    keywords: ["st patrick", "shamrock", "clover", "irish", "lucky"],
    date: on(3, 17),
    buyingOpensDays: 25,
    buyingClosesDays: 3,
    listByDays: 70,
  },
  {
    name: "Easter",
    keywords: ["easter", "bunny", "spring chick", "peeps"],
    date: easter,
    buyingOpensDays: 42,
    buyingClosesDays: 7,
    listByDays: 90,
  },
  {
    name: "Mother's Day",
    keywords: ["mother's day", "mothers day", "mom shirt", "mama", "grandma", "nana"],
    date: nthWeekday(5, 0, 2),
    buyingOpensDays: 40,
    buyingClosesDays: 5,
    listByDays: 90,
  },
  {
    name: "Teacher Appreciation",
    keywords: ["teacher", "paraprofessional", "school counselor", "librarian"],
    date: nthWeekday(5, 2, 1),
    buyingOpensDays: 35,
    buyingClosesDays: 3,
    listByDays: 80,
  },
  {
    name: "Graduation",
    keywords: ["graduation", "graduate", "class of", "senior", "grad"],
    // Not one day: US ceremonies run from late April into June, and this is the
    // middle of that, not a date anyone celebrates.
    date: on(5, 20),
    buyingOpensDays: 60,
    buyingClosesDays: 0,
    listByDays: 110,
  },
  {
    name: "Father's Day",
    keywords: ["father's day", "fathers day", "dad shirt", "papa", "grandpa", "girl dad"],
    date: nthWeekday(6, 0, 3),
    buyingOpensDays: 35,
    buyingClosesDays: 4,
    listByDays: 85,
  },
  {
    name: "Fourth of July",
    keywords: ["4th of july", "fourth of july", "independence day", "patriotic", "usa", "america"],
    date: on(7, 4),
    buyingOpensDays: 33,
    buyingClosesDays: 2,
    listByDays: 80,
  },
  {
    name: "Back to School",
    keywords: ["back to school", "first day of school", "bus driver", "school nurse", "kindergarten"],
    // The season's middle rather than a date; US districts return through August.
    date: on(8, 20),
    buyingOpensDays: 45,
    buyingClosesDays: 0,
    listByDays: 90,
  },
];

const DAY = 86_400_000;

export interface SeasonListing {
  listingId: number;
  title: string;
  /** Epoch seconds. */
  createdAt: number;
  /** Epoch seconds, zero when Etsy gave no end date. */
  endsAt: number;
  autoRenews: boolean;
}

export interface SeasonStatus {
  occasion: string;
  /** ISO date of the occasion itself. */
  date: string;
  daysAway: number;
  /** Where the shop stands: buying not started, running, or over for this year. */
  phase: "ahead" | "buying" | "closing";
  /** Days left to publish something that can still rank in time. Negative once passed. */
  daysToListBy: number;
  matching: number;
  /** Of those, how many were live before the point they needed to be. */
  seasoned: number;
  /**
   * Matching listings that go inactive while buyers are still shopping.
   * Auto-renewing ones are left out: they lapse and come straight back, which
   * costs a listing fee, not a season.
   */
  expiringMidSeason: { listingId: number; title: string; endsAt: number }[];
}

function matches(title: string, keywords: string[]): boolean {
  const haystack = title.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

/** The next time this occasion comes round, this year's or next year's. */
function nextDate(occasion: Occasion, now: Date): Date {
  const year = now.getUTCFullYear();
  const thisYear = occasion.date(year);
  // Still worth showing while buying is winding down, not only before it starts.
  return thisYear.getTime() + occasion.buyingClosesDays * DAY >= now.getTime()
    ? thisYear
    : occasion.date(year + 1);
}

/**
 * Every occasion in the order it arrives, with what the shop has against it.
 *
 * Ordered by date rather than by how badly prepared the shop is: the calendar
 * decides what can still be acted on, and a deadline that has passed cannot be
 * made more urgent by sorting.
 */
export function seasonReport(listings: SeasonListing[], now = new Date()): SeasonStatus[] {
  return OCCASIONS.map((occasion): SeasonStatus => {
    const date = nextDate(occasion, now);
    const daysAway = Math.ceil((date.getTime() - now.getTime()) / DAY);
    const opens = date.getTime() - occasion.buyingOpensDays * DAY;
    const closes = date.getTime() - occasion.buyingClosesDays * DAY;
    const listBy = date.getTime() - occasion.listByDays * DAY;

    const mine = listings.filter((listing) => matches(listing.title, occasion.keywords));

    return {
      occasion: occasion.name,
      date: date.toISOString().slice(0, 10),
      daysAway,
      phase: now.getTime() < opens ? "ahead" : now.getTime() <= closes ? "buying" : "closing",
      daysToListBy: Math.ceil((listBy - now.getTime()) / DAY),
      matching: mine.length,
      // Live before the deadline, so it has had time to earn a place in search.
      seasoned: mine.filter((listing) => listing.createdAt * 1000 <= listBy).length,
      expiringMidSeason: mine
        .filter(
          (listing) =>
            listing.endsAt > 0 &&
            // A listing Etsy renews for you does not go anywhere; warning about
            // it would be crying wolf on every listing in the shop.
            !listing.autoRenews &&
            listing.endsAt * 1000 >= opens &&
            listing.endsAt * 1000 <= closes,
        )
        // Soonest first: the one to deal with is the one about to go.
        .sort((a, b) => a.endsAt - b.endsAt)
        .map((listing) => ({
          listingId: listing.listingId,
          title: listing.title,
          endsAt: listing.endsAt,
        })),
    };
  }).sort((a, b) => a.daysAway - b.daysAway);
}
