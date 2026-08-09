import type Anthropic from "@anthropic-ai/sdk";
import { getClient, MODEL } from "./anthropic";
import { ETSY_LIMITS, type Listing, missingRequiredKeywords, normalizeListing } from "./etsy";

export type Language = "tr" | "en";

export interface GenerateOptions {
  /** Extra context the seller typed in — shop style, target buyer, product type. */
  context?: string;
  /** Language the listing copy should be written in. Etsy US buyers → "en". */
  language?: Language;
  /**
   * Terms that must appear in the title, the description and at least one tag —
   * typically a garment brand such as "Comfort Colors" that buyers search by.
   */
  requiredKeywords?: string[];
}

/**
 * Product facts for brands we support explicitly. Without these the model
 * either guesses at the garment or writes around it; both hurt the listing.
 */
const BRAND_NOTES: Record<string, string> = {
  "comfort colors":
    'Comfort Colors is a garment brand known for heavyweight, garment-dyed ring-spun cotton tees with a relaxed unisex fit and soft, lived-in colour. Buyers search for it by name ("comfort colors shirt", "comfort colors tee"), so treat it as a keyword, not just a label.',
};

function brandNotesFor(keywords: string[]): string[] {
  return keywords
    .map((keyword) => BRAND_NOTES[keyword.trim().toLowerCase()])
    .filter((note): note is string => Boolean(note));
}

const LISTING_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: `Etsy listing title, at most ${ETSY_LIMITS.titleMaxChars} characters. The FIRST 3-4 WORDS must be the exact phrase a buyer types into Etsy search, then separate secondary phrases with commas or pipes.`,
    },
    description: {
      type: "string",
      description:
        "Etsy listing description. Open with a one-sentence hook that repeats the main keyword, then cover what the product is, what is included, sizing/format, and usage ideas. Use short paragraphs and a bulleted list.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: `Exactly ${ETSY_LIMITS.maxTags} Etsy tags, each at most ${ETSY_LIMITS.tagMaxChars} characters. Prefer multi-word long-tail phrases that a buyer would actually type. No duplicated phrases, no single generic words like "gift".`,
    },
    materials: {
      type: "array",
      items: { type: "string" },
      description:
        "Up to 13 materials or file formats (e.g. 'PNG file', 'cotton canvas', 'SVG cut file').",
    },
    category: {
      type: "string",
      description: "Suggested Etsy category path, e.g. 'Craft Supplies & Tools > Digital'.",
    },
    notes: {
      type: "string",
      description:
        "Two or three sentences for the seller explaining the keyword strategy behind these choices, and anything they should verify manually.",
    },
  },
  required: ["title", "description", "tags", "materials", "category", "notes"],
  additionalProperties: false,
} as const;

function systemPrompt(language: Language, requiredKeywords: string[]): string {
  const languageRule =
    language === "tr"
      ? "Write the listing copy in Turkish, but keep the tags in English — Etsy's buyer base searches in English."
      : "Write everything in English.";

  const lines = [
    "You are an Etsy SEO specialist who writes listings that rank in Etsy search and convert browsers into buyers.",
    "",
    "Rules you must follow:",
    `- Title: at most ${ETSY_LIMITS.titleMaxChars} characters, and aim for 110-140 to use the space Etsy gives you.`,
    "- THE OPENING OF THE TITLE IS THE MOST IMPORTANT RANKING SIGNAL. Etsy weights the first few words most heavily, so the first 3-4 words must be, verbatim, the phrase a buyer would type into the search box.",
    "- Do not open the title with a brand name, a shop name, an adjective like 'Beautiful' or 'Unique', or a filler word. Those go later in the title. A brand belongs at the front only when buyers genuinely search for that brand first.",
    "- The opening phrase must also appear among the tags. If you would not use it as a tag, it is not a search phrase and does not belong at the front of the title.",
    `- Tags: exactly ${ETSY_LIMITS.maxTags} tags, each at most ${ETSY_LIMITS.tagMaxChars} characters.`,
    "- Tags must be long-tail buyer phrases, not one-word categories, and must not simply repeat each other.",
    "- Never invent product attributes you cannot see or were not told. If a detail is unknown, describe the design instead of guessing at dimensions, materials, or shipping.",
    "- Do not promise licensing terms, delivery times, or refunds.",
    languageRule,
  ];

  if (requiredKeywords.length > 0) {
    const list = requiredKeywords.map((keyword) => `"${keyword}"`).join(", ");
    lines.push(
      "",
      "Required keywords:",
      `- Each of these terms must appear in the title, at least once in the description, and inside at least one tag: ${list}.`,
      "- Etsy matches title, description and tags separately, so a term present in only one of them is invisible in the other two.",
      "- Keep the term readable in context — work it into a natural phrase (e.g. a tag like 'comfort colors tee'), do not bolt it on as a bare label.",
      "- These terms are additional to, not a replacement for, the search phrase that opens the title.",
    );

    const notes = brandNotesFor(requiredKeywords);
    if (notes.length > 0) {
      lines.push("", "Product facts you may rely on:", ...notes.map((note) => `- ${note}`));
    }
  }

  return lines.join("\n");
}

/** One structured-output call. */
async function callModel(
  content: Anthropic.ContentBlockParam[],
  language: Language,
  requiredKeywords: string[],
): Promise<Listing> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: LISTING_SCHEMA },
    },
    system: systemPrompt(language, requiredKeywords),
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Model bu istegi reddetti. Lutfen farkli bir tasarim veya nis deneyin.");
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Model bos yanit dondu. Tekrar deneyin.");
  }

  return normalizeListing(JSON.parse(text.text) as Listing);
}

/**
 * Runs the request and, when a required keyword is missing from one of the
 * three match surfaces, retries once with the gap spelled out. A brand term the
 * seller explicitly asked for is worth one extra call — patching it in by
 * string surgery would produce a title that reads like a keyword dump.
 */
async function requestListing(
  content: Anthropic.ContentBlockParam[],
  options: GenerateOptions,
): Promise<Listing> {
  const language = options.language ?? "en";
  const requiredKeywords = (options.requiredKeywords ?? []).map((k) => k.trim()).filter(Boolean);

  const listing = await callModel(content, language, requiredKeywords);

  const missing = missingRequiredKeywords(listing, requiredKeywords);
  if (missing.length === 0) return listing;

  const fieldNames = { title: "the title", description: "the description", tags: "the tags" };
  const corrections = missing.map(
    (entry) =>
      `- "${entry.keyword}" is missing from ${entry.fields.map((f) => fieldNames[f]).join(" and ")}.`,
  );

  const retry = await callModel(
    [
      ...content,
      {
        type: "text",
        text: [
          "A previous attempt at this listing failed its keyword requirements:",
          ...corrections,
          "",
          "Write the listing again with those terms worked in naturally, while keeping every other rule — especially that the first 3-4 words of the title are the buyer's search phrase.",
        ].join("\n"),
      },
    ],
    language,
    requiredKeywords,
  );

  // If the retry still falls short, return it anyway — inspectListing surfaces
  // the gap in the UI, which beats failing the whole request.
  return missingRequiredKeywords(retry, requiredKeywords).length <= missing.length
    ? retry
    : listing;
}

/** Generates a listing from a niche keyword pulled out of a Google Sheet. */
export function generateFromNiche(niche: string, options: GenerateOptions = {}): Promise<Listing> {
  const extra = options.context?.trim();
  const prompt = [
    `Write an Etsy listing for this niche/product idea:\n\n${niche}`,
    extra ? `\n\nSeller context:\n${extra}` : "",
  ].join("");

  return requestListing([{ type: "text", text: prompt }], options);
}

export interface DesignInput {
  /** Base64-encoded image data, without the data: URI prefix. */
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

/** Generates a listing by looking at an uploaded design file. */
export function generateFromDesign(
  design: DesignInput,
  options: GenerateOptions = {},
): Promise<Listing> {
  const extra = options.context?.trim();
  const prompt = [
    "Look at this design and write an Etsy listing for the product it would be sold as.",
    "Describe what you actually see — subject, style, colour palette, typography, mood — and build the keywords from that.",
    extra ? `\nSeller context:\n${extra}` : "",
  ].join("\n");

  return requestListing(
    [
      { type: "image", source: { type: "base64", media_type: design.mediaType, data: design.data } },
      { type: "text", text: prompt },
    ],
    options,
  );
}
