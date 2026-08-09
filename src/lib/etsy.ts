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
 * Reports where the generated listing fell short of Etsy best practice, so the
 * UI can flag it instead of silently shipping a weak listing.
 */
export function inspectListing(listing: Listing, requiredKeywords: string[] = []): ListingWarning[] {
  const warnings: ListingWarning[] = [];

  const fieldLabels = { title: "baslik", description: "aciklama", tags: "etiketler" } as const;
  for (const missing of missingRequiredKeywords(listing, requiredKeywords)) {
    warnings.push({
      field: "title",
      message: `"${missing.keyword}" su alanlarda gecmiyor: ${missing.fields
        .map((field) => fieldLabels[field])
        .join(", ")}. Etsy bu alanlari ayri ayri esler.`,
    });
  }

  if (!opensWithSearchPhrase(listing)) {
    warnings.push({
      field: "title",
      message:
        "Basligin ilk 3-4 kelimesi bir arama ifadesi gibi durmuyor. Etsy basligin basini en agir sekilde tartar — musterinin yazacagi ifadeyle baslatin.",
    });
  }

  if (listing.title.length < 60) {
    warnings.push({
      field: "title",
      message: `Baslik ${listing.title.length} karakter. Etsy aramasi icin 100-140 arasi daha iyi calisir.`,
    });
  }
  if (listing.tags.length < ETSY_LIMITS.maxTags) {
    warnings.push({
      field: "tags",
      message: `${listing.tags.length}/${ETSY_LIMITS.maxTags} etiket kullanildi. 13'unu de doldurmak gorunurlugu artirir.`,
    });
  }
  if (listing.description.length < 200) {
    warnings.push({
      field: "description",
      message: "Aciklama cok kisa. Urun detaylari ve kullanim onerileri ekleyin.",
    });
  }

  return warnings;
}
