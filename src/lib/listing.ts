import type Anthropic from "@anthropic-ai/sdk";
import { getClient, MODEL } from "./anthropic";
import { ETSY_LIMITS, type Listing, normalizeListing } from "./etsy";

export type Language = "tr" | "en";

export interface GenerateOptions {
  /** Extra context the seller typed in — shop style, target buyer, product type. */
  context?: string;
  /** Language the listing copy should be written in. Etsy US buyers → "en". */
  language?: Language;
}

const LISTING_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: `Etsy listing title, at most ${ETSY_LIMITS.titleMaxChars} characters. Front-load the most-searched keyword phrase, then separate secondary phrases with commas or pipes.`,
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

function systemPrompt(language: Language): string {
  const languageRule =
    language === "tr"
      ? "Write the listing copy in Turkish, but keep the tags in English — Etsy's buyer base searches in English."
      : "Write everything in English.";

  return [
    "You are an Etsy SEO specialist who writes listings that rank in Etsy search and convert browsers into buyers.",
    "",
    "Rules you must follow:",
    `- Title: at most ${ETSY_LIMITS.titleMaxChars} characters, and aim for 110-140 to use the space Etsy gives you.`,
    `- Tags: exactly ${ETSY_LIMITS.maxTags} tags, each at most ${ETSY_LIMITS.tagMaxChars} characters.`,
    "- Tags must be long-tail buyer phrases, not one-word categories, and must not simply repeat each other.",
    "- Never invent product attributes you cannot see or were not told. If a detail is unknown, describe the design instead of guessing at dimensions, materials, or shipping.",
    "- Do not promise licensing terms, delivery times, or refunds.",
    languageRule,
  ].join("\n");
}

/**
 * Runs one structured-output request and returns the normalised listing.
 */
async function requestListing(
  content: Anthropic.ContentBlockParam[],
  options: GenerateOptions,
): Promise<Listing> {
  const language = options.language ?? "en";

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: LISTING_SCHEMA },
    },
    system: systemPrompt(language),
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
