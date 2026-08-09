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
  /** Etsy's "attributes" free-text hints, e.g. suggested category or occasion. */
  category: string;
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
 * Etsy weights the opening of the title most heavily, so the first few words
 * have to be the phrase a buyer would actually type. We can't read Etsy's
 * index, but we can check the model's own judgement against itself: if the
 * opening words are real search terms, they should also show up in the tags it
 * chose. Fewer than two overlapping words means the title likely opens with
 * branding or filler instead.
 */
function opensWithSearchPhrase(listing: Listing): boolean {
  const opening = words(listing.title).slice(0, 4).filter((word) => !STOPWORDS.has(word));
  if (opening.length === 0) return false;

  const tagWords = new Set(listing.tags.flatMap(words));
  const overlap = opening.filter((word) => tagWords.has(word)).length;

  return overlap >= Math.min(2, opening.length);
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

  if (!opensWithSearchPhrase(listing)) {
    warnings.push({
      field: "title",
      message:
        "The first 3-4 words don't look like a search phrase. Etsy weights the start of the title most heavily — open with what a buyer would type.",
    });
  }

  if (listing.title.length < 60) {
    warnings.push({
      field: "title",
      message: `Title is ${listing.title.length} characters. Etsy search rewards 100-140.`,
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
      message: "Description is thin. Add fit, feel, and occasion details.",
    });
  }

  return warnings;
}
