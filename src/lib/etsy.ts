/**
 * Etsy listing constraints and the normalisation we apply before showing a
 * generated listing to the user.
 *
 * The model is told about these limits in the prompt, but Etsy rejects a
 * listing outright when they are exceeded, so we enforce them here too rather
 * than trusting generation alone.
 */

export const ETSY_LIMITS = {
  titleMaxChars: 140,
  tagMaxChars: 20,
  maxTags: 13,
  maxMaterials: 13,
  materialMaxChars: 45,
  descriptionMaxChars: 5000,
} as const;

export interface Listing {
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  /** Suggested Etsy category path; the seller still picks the real taxonomy. */
  category: string;
  /** Suggested Etsy attributes, as "Attribute: value" lines. */
  attributes: string;
  /** Short rationale shown in the UI so the user can judge the suggestion. */
  notes: string;
}

/** Tags may only contain letters, numbers, spaces and a few separators. */
function cleanTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ETSY_LIMITS.tagMaxChars)
    .trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/**
 * Trims a title to the character limit without cutting a word in half.
 */
function truncateTitle(title: string): string {
  const collapsed = title.replace(/\s+/g, " ").trim();
  if (collapsed.length <= ETSY_LIMITS.titleMaxChars) return collapsed;

  const hard = collapsed.slice(0, ETSY_LIMITS.titleMaxChars);
  const lastBreak = Math.max(hard.lastIndexOf(" "), hard.lastIndexOf(","), hard.lastIndexOf("|"));
  const trimmed = lastBreak > 40 ? hard.slice(0, lastBreak) : hard;
  return trimmed.replace(/[\s,|-]+$/, "").trim();
}

export function normalizeListing(listing: Listing): Listing {
  return {
    title: truncateTitle(listing.title),
    description: listing.description.trim().slice(0, ETSY_LIMITS.descriptionMaxChars),
    tags: dedupe(listing.tags.map(cleanTag).filter(Boolean)).slice(0, ETSY_LIMITS.maxTags),
    materials: dedupe(
      listing.materials.map((m) => m.trim().slice(0, ETSY_LIMITS.materialMaxChars)).filter(Boolean),
    ).slice(0, ETSY_LIMITS.maxMaterials),
    category: listing.category.trim(),
    attributes: listing.attributes.trim(),
    notes: listing.notes.trim(),
  };
}

export interface ListingWarning {
  field: keyof Listing;
  message: string;
}

/** Words that carry no search intent, so they don't count as opening keywords. */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "with",
  "of",
  "to",
  "in",
  "on",
  "by",
  "new",
  "best",
  "beautiful",
  "unique",
  "perfect",
  "great",
  "amazing",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Wording Etsy tells sellers to keep out of a title. It is promotional rather
 * than descriptive, so it takes room from the words a buyer actually searches.
 */
const PROMOTIONAL_TERMS = [
  "sale",
  "on sale",
  "free shipping",
  "best seller",
  "bestseller",
  "perfect gift",
  "best gift",
  "great gift",
  "amazing",
  "beautiful",
  "must have",
  "cheap",
  "top quality",
];

export function promotionalTermsIn(title: string): string[] {
  const haystack = title.toLowerCase();
  return PROMOTIONAL_TERMS.filter((term) =>
    new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}\\b`).test(haystack),
  );
}

/**
 * Words the title leans on more than once. Repeating a term used to be how you
 * ranked for it; Etsy now reads the title as a whole, so a repeat is a word
 * spent twice on one search instead of once each on two.
 */
export function repeatedTitleWords(title: string): string[] {
  const counts = new Map<string, number>();
  for (const word of words(title)) {
    // Short words are the connective tissue of a readable title, not stuffing.
    if (STOPWORDS.has(word) || word.length < 4) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()].filter(([, count]) => count > 1).map(([word]) => word);
}

/**
 * Tags that reach for the same search as another tag. Two tags sharing every
 * significant word ("custom name ornament" and "personalized name ornament"
 * do not; "name ornament" and "custom name ornament" do) compete with each
 * other rather than covering a query the listing would otherwise miss.
 */
export function duplicatedTags(tags: string[]): string[] {
  const significant = tags.map(
    (tag) => new Set(words(tag).filter((word) => !STOPWORDS.has(word))),
  );

  const flagged: string[] = [];
  for (let i = 0; i < tags.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const [smaller, larger] =
        significant[i].size <= significant[j].size
          ? [significant[i], significant[j]]
          : [significant[j], significant[i]];
      if (smaller.size === 0) continue;

      // Contained in another tag: every word it searches, the other searches too.
      if ([...smaller].every((word) => larger.has(word))) {
        flagged.push(tags[i]);
        break;
      }
    }
  }

  return flagged;
}

/**
 * Which of the required terms (e.g. a garment brand like "Comfort Colors") are
 * missing from each field. Etsy treats title, description and tags as separate
 * match surfaces, so a brand term has to appear in all three to be searchable.
 */
export function missingRequiredKeywords(
  listing: Listing,
  required: string[],
): { keyword: string; fields: ("title" | "description" | "tags")[] }[] {
  const results: { keyword: string; fields: ("title" | "description" | "tags")[] }[] = [];

  for (const raw of required) {
    const keyword = raw.trim().toLowerCase();
    if (!keyword) continue;

    const fields: ("title" | "description" | "tags")[] = [];
    if (!listing.title.toLowerCase().includes(keyword)) fields.push("title");
    if (!listing.description.toLowerCase().includes(keyword)) fields.push("description");
    if (!listing.tags.some((tag) => tag.toLowerCase().includes(keyword))) fields.push("tags");

    if (fields.length > 0) results.push({ keyword: raw.trim(), fields });
  }

  return results;
}

/**
 * A required term needs to be in the tags to be searchable, but only so many
 * times. Two variants cover the brand search; a third is a slot spent competing
 * with your own listing instead of reaching a different query.
 */
export const MAX_TAGS_PER_REQUIRED_KEYWORD = 2;

/** Required terms that are eating more tag slots than they earn. */
export function overusedKeywords(
  listing: Listing,
  required: string[],
): { keyword: string; count: number }[] {
  return required
    .map((raw) => {
      const keyword = raw.trim().toLowerCase();
      const count = listing.tags.filter((tag) => tag.toLowerCase().includes(keyword)).length;
      return { keyword: raw.trim(), count };
    })
    .filter((entry) => entry.count > MAX_TAGS_PER_REQUIRED_KEYWORD);
}

/**
 * Terms that describe a digital product. The shop sells printed shirts, so a
 * buyer searching these wants a file and will bounce — they are wrong traffic,
 * not just wrong wording. Matched on word boundaries so "pngs" is caught but a
 * word merely containing the letters is not.
 */
const DIGITAL_TERMS = [
  "png",
  "svg",
  "jpg",
  "jpeg",
  "pdf",
  "eps",
  "dxf",
  "clipart",
  "printable",
  // "download" on its own covers "instant download", "sublimation download",
  // and anything else that promises a file rather than a shirt.
  "download",
  "downloadable",
  "digital file",
  "cut file",
  "print at home",
];

/** Digital-product terms present in the fields Etsy matches on. */
export function digitalTermsIn(listing: Listing): string[] {
  const haystack = [listing.title, ...listing.tags, ...listing.materials].join(" ").toLowerCase();

  return DIGITAL_TERMS.filter((term) =>
    new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}s?\\b`).test(haystack),
  );
}

/**
 * Reports where the generated listing fell short of Etsy best practice, so the
 * UI can flag it instead of silently shipping a weak listing.
 */
export function inspectListing(listing: Listing, requiredKeywords: string[] = []): ListingWarning[] {
  const warnings: ListingWarning[] = [];

  for (const missing of missingRequiredKeywords(listing, requiredKeywords)) {
    warnings.push({
      field: "title",
      message: `"${missing.keyword}" is missing from the ${missing.fields.join(
        " and ",
      )}. Etsy matches those fields separately.`,
    });
  }

  for (const overused of overusedKeywords(listing, requiredKeywords)) {
    warnings.push({
      field: "tags",
      message: `${overused.count} tags contain "${overused.keyword}". Two cover that search — the rest are slots not reaching a new query.`,
    });
  }

  const digital = digitalTermsIn(listing);
  if (digital.length > 0) {
    warnings.push({
      field: "title",
      message: `Reads like a digital product: ${digital.join(
        ", ",
      )}. You sell printed shirts — buyers searching these terms want a file and will bounce.`,
    });
  }

  const promotional = promotionalTermsIn(listing.title);
  if (promotional.length > 0) {
    warnings.push({
      field: "title",
      message: `Promotional wording in the title: ${promotional.join(
        ", ",
      )}. Etsy asks you to leave it out — it takes room from words buyers search.`,
    });
  }

  const repeated = repeatedTitleWords(listing.title);
  if (repeated.length > 0) {
    warnings.push({
      field: "title",
      message: `"${repeated.join('", "')}" ${
        repeated.length === 1 ? "appears" : "appear"
      } more than once in the title. Repeating a term no longer ranks it higher — say it once and use the room for something else.`,
    });
  }

  // Etsy's own guidance is a clear, human-readable title; long keyword chains
  // are the tactic it moved away from.
  const titleWords = words(listing.title).length;
  if (titleWords > 15) {
    warnings.push({
      field: "title",
      message: `Title runs to ${titleWords} words. Aim for under 15 — a title a buyer can read beats one padded with keywords.`,
    });
  }

  const duplicated = duplicatedTags(listing.tags);
  if (duplicated.length > 0) {
    warnings.push({
      field: "tags",
      message: `${duplicated.length} tag${
        duplicated.length === 1 ? "" : "s"
      } cover a search another tag already reaches: ${duplicated.join(
        ", ",
      )}. Each one is a slot that could be finding a different buyer.`,
    });
  }

  if (listing.tags.length < ETSY_LIMITS.maxTags) {
    warnings.push({
      field: "tags",
      message: `Only ${listing.tags.length}/${ETSY_LIMITS.maxTags} tags used. Filling all 13 widens your reach.`,
    });
  }
  if (listing.description.length < 200) {
    warnings.push({
      field: "description",
      message: "Description is thin. Say what the product is, what the design shows, and what sets it apart.",
    });
  }

  // Etsy reads the description too, so opening it with the title verbatim
  // spends the strongest lines of the listing repeating what it already says.
  if (listing.description.slice(0, listing.title.length).trim() === listing.title.trim()) {
    warnings.push({
      field: "description",
      message: "The description opens with the title word for word. Lead with what the product is and what the design shows instead.",
    });
  }

  return warnings;
}
