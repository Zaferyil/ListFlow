/**
 * Listings in the same shop chasing the same search.
 *
 * Etsy shows one shop only so often for a given query. Two listings built
 * around the same phrase therefore do not double the shop's chances — they
 * split them, and the weaker one drags on the pair. At a hundred listings this
 * is a curiosity; at several hundred, in a shop that lists the same occasion
 * every season, it is likely the largest single thing holding the shop back,
 * and no amount of rewriting one listing at a time will find it.
 *
 * The check already existed for a listing being written. It never ran across
 * the shop that was already there, which is where the problem actually
 * accumulated.
 */

import type { ShopListing } from "./etsy";

export interface CompetingGroup {
  /** What they are all chasing, in the words they share. */
  phrase: string;
  /**
   * The one to leave alone: the listing with the most evidence behind it.
   * Splitting a query is only worth solving if something is kept whole.
   */
  keep: CompetingListing;
  /** The rest, strongest first. */
  others: CompetingListing[];
}

export interface CompetingListing {
  listingId: number;
  title: string;
  unitsSold: number;
  favorites: number;
  imageCount: number;
}

export interface CannibalInput extends ShopListing {
  unitsSold: number;
  favorites: number;
  imageCount: number;
}

/**
 * A tag on a quarter of the shop says nothing about which listings compete.
 *
 * Every listing here is a Comfort Colors graphic tee, so "comfort colors",
 * "graphic tee" and "vintage shirt" sit on hundreds of them. Counting those as
 * overlap would merge the entire shop into one group and report it as a single
 * enormous problem, which is true of no shop and useful to none.
 */
const UBIQUITOUS = 0.25;

/** Shared distinctive tags at which two listings are chasing one query. */
const SHARED_TAGS = 4;

/** Shared distinctive title words to go with them, so tags alone cannot do it. */
const SHARED_WORDS = 2;

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "for", "with", "of", "to", "in", "on", "by",
  "new", "best", "unique", "perfect", "gift", "gifts", "shirt", "tee", "tshirt",
  "t", "shirts", "tees", "her", "him", "men", "women", "mens", "womens",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** The two words a title opens on — the unit a buyer actually types. */
function leadPhrase(title: string): string {
  return words(title).slice(0, 2).join(" ");
}

/** Terms carried by so much of the shop that they cannot tell listings apart. */
function ubiquitous(sets: string[][], total: number): Set<string> {
  const seen = new Map<string, number>();
  for (const set of sets) {
    for (const term of new Set(set)) {
      seen.set(term, (seen.get(term) ?? 0) + 1);
    }
  }

  const limit = Math.max(3, Math.ceil(total * UBIQUITOUS));
  return new Set([...seen].filter(([, count]) => count >= limit).map(([term]) => term));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared;
}

/**
 * Which listing to keep whole when several chase one query.
 *
 * Sales first and by a distance: a listing that has sold has an answer from
 * buyers, and nothing else here is more than a guess. Then favourites, then
 * photos — the same order of evidence the rest of the app reads.
 */
function strength(listing: CannibalInput): number {
  return listing.unitsSold * 1000 + listing.favorites * 10 + listing.imageCount;
}

/**
 * Groups of listings competing with each other, largest group first.
 *
 * Two listings are grouped when they open on the same phrase, or when they
 * share enough distinctive tags *and* distinctive title words that a buyer
 * typing either would be shown both. Both are required in the second case: tags
 * alone put every seasonal listing together, and words alone catch titles that
 * merely sound alike.
 */
export function competingGroups(listings: CannibalInput[]): CompetingGroup[] {
  if (listings.length < 2) return [];

  const commonTags = ubiquitous(
    listings.map((listing) => listing.tags.map((tag) => tag.toLowerCase())),
    listings.length,
  );
  const commonWords = ubiquitous(listings.map((listing) => words(listing.title)), listings.length);

  const marks = listings.map((listing) => ({
    lead: leadPhrase(listing.title),
    tags: new Set(
      listing.tags.map((tag) => tag.toLowerCase()).filter((tag) => !commonTags.has(tag)),
    ),
    words: new Set(words(listing.title).filter((word) => !commonWords.has(word))),
    // Kept unfiltered for the group's label. Naming a group is describing it,
    // not telling its members apart, and the word the whole crowd is built on
    // is exactly the one the distinctive set has thrown away.
    all: words(listing.title),
  }));

  // Union-find, so a chain of listings that each compete with the next is
  // reported as the one crowd it is rather than as a scatter of pairs.
  const parent = listings.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < listings.length; i += 1) {
    for (let j = i + 1; j < listings.length; j += 1) {
      const sameLead = marks[i].lead.length > 0 && marks[i].lead === marks[j].lead;
      const crowded =
        overlap(marks[i].tags, marks[j].tags) >= SHARED_TAGS &&
        overlap(marks[i].words, marks[j].words) >= SHARED_WORDS;

      if (sameLead || crowded) union(i, j);
    }
  }

  const grouped = new Map<number, number[]>();
  for (let index = 0; index < listings.length; index += 1) {
    const root = find(index);
    grouped.set(root, [...(grouped.get(root) ?? []), index]);
  }

  return [...grouped.values()]
    .filter((members) => members.length > 1)
    .map((members) => {
      const sorted = members
        .map((index) => listings[index])
        .sort((a, b) => strength(b) - strength(a));

      const [keep, ...others] = sorted;
      return {
        phrase: sharedPhrase(members.map((index) => marks[index])),
        keep: describe(keep),
        others: others.map(describe),
      };
    })
    .sort((a, b) => b.others.length - a.others.length);
}

function describe(listing: CannibalInput): CompetingListing {
  return {
    listingId: listing.listingId,
    title: listing.title,
    unitsSold: listing.unitsSold,
    favorites: listing.favorites,
    imageCount: listing.imageCount,
  };
}

/**
 * What the group has in common, said in its own words.
 *
 * A group headed "these 9 listings compete" is a claim the seller has to take
 * on trust; one headed "halloween, spooky, ghost" can be checked against the
 * titles in a second, and argued with.
 */
function sharedPhrase(marks: { lead: string; all: string[] }[]): string {
  const counts = new Map<string, number>();
  for (const mark of marks) {
    for (const word of new Set(mark.all)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  const common = [...counts]
    .filter(([, count]) => count >= Math.ceil(marks.length / 2))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);

  return common.length > 0 ? common.join(", ") : marks[0].lead;
}
