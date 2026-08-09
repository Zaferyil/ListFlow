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

/**
 * Reports where the generated listing fell short of Etsy best practice, so the
 * UI can flag it instead of silently shipping a weak listing.
 */
export function inspectListing(listing: Listing): ListingWarning[] {
  const warnings: ListingWarning[] = [];

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
